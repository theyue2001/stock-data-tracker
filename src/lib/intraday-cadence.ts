/**
 * When the shared intraday collector (scripts/cron.ts) polls, as pure
 * functions of the clock so the schedule is unit-testable without waiting for
 * a trading day.
 *
 * The rules:
 *  - Ticks fall on a fixed grid from the 09:00:00 open, every
 *    `intervalSec` seconds, while the session is open (09:00–13:30 Taipei).
 *    A grid rather than "interval after the last tick" so a slow tick never
 *    drifts the schedule and a missed one is skipped, not made up in a burst.
 *  - One more tick at FINAL_TICK_MIN (13:35) for the closing print: TWSE
 *    stamps the TAIEX value after the closing call auction a few minutes past
 *    13:30 (13:33:00 on 2026-11-17), which a 13:29 tick cannot see.
 *  - Nothing in between sessions: after the final tick the next one is the
 *    next trading day's open, skipping weekends and the TWSE holiday table in
 *    market-session.ts.
 *
 * Taipei has been UTC+8 with no daylight saving since 1979, so a Taipei wall
 * clock time maps to a fixed UTC offset.
 */
import { SESSION_CLOSE_MIN, SESSION_OPEN_MIN, addDays, isTradingDay, taipeiNow } from "@/lib/market-session";

/** INTRADAY_INTERVAL_SECONDS when unset or invalid. */
export const DEFAULT_INTRADAY_INTERVAL_SECONDS = 60;

/** Minutes after Taipei midnight of the one post-close tick (13:35). */
export const FINAL_TICK_MIN = SESSION_CLOSE_MIN + 5;

/**
 * A tick due less than this far ahead counts as already taken. Guards against
 * a timer that fires a hair early recomputing the very grid point it was
 * scheduled for and ticking twice.
 */
const MIN_LEAD_MS = 500;

/** How far ahead to look for the next trading day (the longest TWSE closure,
 *  Lunar New Year, is under two weeks). */
const LOOKAHEAD_DAYS = 40;

/** Epoch ms of a Taipei wall-clock time: `date` (YYYY-MM-DD) plus `minutes` after midnight. */
export function taipeiInstant(date: string, minutes: number): number {
  return Date.parse(`${date}T00:00:00+08:00`) + minutes * 60_000;
}

export interface IntradayInterval {
  /** Interval the collector uses, in whole seconds. */
  seconds: number;
  /** What INTRADAY_INTERVAL_SECONDS asked for (the default when unset); null when it was not a positive number. */
  requested: number | null;
  /** Largest `minIntervalSeconds` among the registered intraday providers. */
  floor: number;
  /** True when the request was below `floor` and was raised to it. */
  clamped: boolean;
}

/**
 * Resolves INTRADAY_INTERVAL_SECONDS against the providers' floor. The floor
 * wins: the env var can slow polling down but never push it past what the
 * slowest registered source allows.
 */
export function resolveIntradayInterval(raw: string | undefined, floorSeconds: number): IntradayInterval {
  const text = raw?.trim();
  const parsed = text ? Number(text) : DEFAULT_INTRADAY_INTERVAL_SECONDS;
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const base = Math.ceil(requested ?? DEFAULT_INTRADAY_INTERVAL_SECONDS);
  const floor = Math.max(0, Math.ceil(floorSeconds));
  return { seconds: Math.max(base, floor, 1), requested, floor, clamped: base < floor };
}

/**
 * The instant of the next intraday tick strictly after `now` (by at least
 * MIN_LEAD_MS): the next grid point of today's session, else today's final
 * tick, else the next trading day's open.
 */
export function nextIntradayTickAt(now: Date, intervalSec: number): Date {
  const stepMs = Math.max(1, intervalSec) * 1000;
  const earliest = now.getTime() + MIN_LEAD_MS;
  let date = taipeiNow(now).date;

  for (let i = 0; i <= LOOKAHEAD_DAYS; i++, date = addDays(date, 1)) {
    if (!isTradingDay(date)) continue;
    const open = taipeiInstant(date, SESSION_OPEN_MIN);
    const close = taipeiInstant(date, SESSION_CLOSE_MIN);
    const final = taipeiInstant(date, FINAL_TICK_MIN);

    if (earliest <= open) return new Date(open);
    if (earliest < close) {
      const grid = open + Math.ceil((earliest - open) / stepMs) * stepMs;
      if (grid < close) return new Date(grid);
    }
    if (earliest <= final) return new Date(final);
  }
  // Unreachable while the calendar has a trading day within LOOKAHEAD_DAYS;
  // re-check tomorrow rather than spin.
  return new Date(now.getTime() + 24 * 3600_000);
}

/** Milliseconds from `now` until the next intraday tick. */
export function nextIntradayDelayMs(now: Date, intervalSec: number): number {
  return nextIntradayTickAt(now, intervalSec).getTime() - now.getTime();
}

const taipeiFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD HH:mm:ss" in Taipei time, for scheduler log lines. */
export function formatTaipei(at: Date): string {
  const p = Object.fromEntries(taipeiFormat.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
