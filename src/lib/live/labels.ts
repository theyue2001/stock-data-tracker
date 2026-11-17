/**
 * How every market figure on the dashboard says what it is and how old it is.
 *
 * Pure and clock-free: every function takes `now` explicitly (or `null` when
 * the caller cannot know it, e.g. while prerendering), so the same rules run
 * in the /api/live handler, in the browser between polls, and in unit tests.
 *
 * Only the TAIEX index has an intraday source (the MIS poller); every other
 * number on the site is an after-hours close. The rules below exist so an
 * intraday print is never presented as the close, a close is never presented
 * as live, and a tick that stopped moving is never presented as 即時.
 *
 * Relative imports only: `npm test` runs these files through tsx without the
 * `@/` path alias.
 */
import { isTradingDay, marketPhase, previousTradingDay, taipeiNow, addDays, expectedLatestSession } from "../market-session";

/** Poll cadence of the intraday TAIEX job when INTRADAY_INTERVAL_SECONDS is unset. */
export const DEFAULT_INTRADAY_INTERVAL_SECONDS = 60;

/** One stored intraday TAIEX row, as the label rules need it. */
export interface IntradayTick {
  /** Session the tick belongs to (the feed's own trading date), YYYY-MM-DD. */
  date: string;
  /** Exchange-reported time of the tick, "HH:MM:SS" Taipei. May be empty when the feed omitted it. */
  tickAt: string;
  /** When the poller last wrote the row, ISO instant. */
  updatedAt: string;
}

export type TaiexKind =
  /** market open, tick no older than 2 × the poll interval */
  | "live"
  /** market open, tick older than that */
  | "delayed"
  /** an intraday tick whose session has ended but whose official close is not stored yet */
  | "last-tick"
  /** the official close of today's session */
  | "close"
  /** the official close of the trading day before today */
  | "previous-close"
  /** an official close older than the previous trading day (the stale banner explains why) */
  | "older-close";

export interface TaiexLabel {
  /** Which stored figure to display: the intraday tick or the official close. */
  source: "intraday" | "close";
  /** null when `now` is unknown — the text is then a timestamp that is true at any time. */
  kind: TaiexKind | null;
  text: string;
  /** Session the displayed figure belongs to, YYYY-MM-DD. */
  session: string;
  /** Seconds since the tick, for intraday figures when `now` is known. */
  ageSeconds: number | null;
}

export interface TaiexLabelInput {
  /** Newest official TAIEX close the caller can actually display, YYYY-MM-DD. */
  closeSession: string | null;
  /** Newest stored intraday tick, if any. */
  intraday: IntradayTick | null;
  /** Poll interval of the intraday job, seconds. */
  intervalSeconds: number;
}

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** "2026-11-17" → "11/17" */
export function mmdd(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

/** "2026-11-17" → "11/17（二）" */
export function mmddWeekday(date: string): string {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${mmdd(date)}（${WEEKDAY[wd]}）`;
}

const taipeiClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function taipeiParts(instant: Date): Record<string, string> {
  return Object.fromEntries(taipeiClock.formatToParts(instant).map((p) => [p.type, p.value]));
}

/** An instant as Taipei "MM/DD HH:MM" — the format for "last updated" stamps. */
export function taipeiStamp(iso: string): string {
  const p = taipeiParts(new Date(iso));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

const TICK_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The tick time as "HH:MM:SS": the feed's own stamp, else when the row was written. */
function tickClock(tick: IntradayTick): string {
  const m = TICK_RE.exec(tick.tickAt.trim());
  if (m) return `${m[1]}:${m[2]}:${m[3] ?? "00"}`;
  const p = taipeiParts(new Date(tick.updatedAt));
  return `${p.hour}:${p.minute}:${p.second}`;
}

/**
 * The instant the tick describes. The feed's tick time is the market-data
 * time; `updatedAt` is only when we fetched it, so it is the fallback for a
 * row the feed did not stamp.
 */
export function tickInstant(tick: IntradayTick): Date {
  const m = TICK_RE.exec(tick.tickAt.trim());
  if (m) return new Date(`${tick.date}T${m[1]}:${m[2]}:${m[3] ?? "00"}+08:00`);
  return new Date(tick.updatedAt);
}

/** "25 秒" / "3 分鐘" / "2 小時" */
function ageText(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘`;
  return `${Math.floor(seconds / 3600)} 小時`;
}

/**
 * Which TAIEX figure to show and how to label it.
 *
 * The intraday tick wins only while it describes a newer session than the
 * newest stored official close; once that session's close is stored the
 * close always wins, so an intraday print is never shown next to (or instead
 * of) a settled close for the same session. Holidays need no special case:
 * MIS answers a closed market with the last session's tick, keyed to that
 * session's own date, whose close is normally already stored.
 */
export function describeTaiex(input: TaiexLabelInput, now: Date | null): TaiexLabel | null {
  const { closeSession, intraday } = input;

  if (intraday && (!closeSession || intraday.date > closeSession)) {
    const clock = tickClock(intraday);
    if (!now) {
      // Prerendered HTML: no clock, so say only what is true at any time.
      return { source: "intraday", kind: null, text: `盤中 ${mmdd(intraday.date)} ${clock}`, session: intraday.date, ageSeconds: null };
    }

    const ageSeconds = Math.max(0, Math.round((now.getTime() - tickInstant(intraday).getTime()) / 1000));
    const today = taipeiNow(now).date;
    const base = { source: "intraday" as const, session: intraday.date, ageSeconds };

    if (intraday.date === today && marketPhase(now) === "open") {
      if (ageSeconds <= 2 * Math.max(1, input.intervalSeconds)) {
        return { ...base, kind: "live", text: `即時 ${clock}` };
      }
      return { ...base, kind: "delayed", text: `延遲（${ageText(ageSeconds)}前）· ${clock}` };
    }

    // The session this tick belongs to is over (or never was today's), and
    // its official close has not been stored: the last print, not the close.
    const when = intraday.date === today ? clock.slice(0, 5) : `${mmdd(intraday.date)} ${clock.slice(0, 5)}`;
    return { ...base, kind: "last-tick", text: `盤中最後一筆 ${when}（收盤資料尚未入庫）` };
  }

  if (!closeSession) return null;

  const base = { source: "close" as const, session: closeSession, ageSeconds: null };
  if (!now) return { ...base, kind: null, text: `收盤 ${mmdd(closeSession)}` };

  const today = taipeiNow(now).date;
  if (closeSession >= today) return { ...base, kind: "close", text: `收盤 ${mmdd(closeSession)}` };
  if (closeSession === previousTradingDay(today)) {
    return { ...base, kind: "previous-close", text: `前一交易日收盤 ${mmdd(closeSession)}` };
  }
  return { ...base, kind: "older-close", text: `收盤 ${mmdd(closeSession)}` };
}

/** Trading days d with `from` < d ≤ `to`; 0 when `to` is not after `from`. */
export function tradingDaysBetween(from: string, to: string): number {
  let n = 0;
  // Bounded walk: a year and a half of calendar days is far more than any
  // gap worth counting precisely, and keeps a corrupt date from looping.
  for (let d = addDays(from, 1), i = 0; d <= to && i < 550; d = addDays(d, 1), i++) {
    if (isTradingDay(d)) n++;
  }
  return n;
}

export interface Freshness {
  /** Newest stored session, YYYY-MM-DD, or null when nothing is stored. */
  session: string | null;
  /** Session whose after-hours close should already be out by `now`. */
  expectedSession: string;
  /** Trading days between the stored and the expected session. */
  behindTradingDays: number;
  stale: boolean;
}

/** Whether the newest stored after-hours session is behind the one that should be out by now. */
export function freshness(session: string | null, now: Date): Freshness {
  const expectedSession = expectedLatestSession(now);
  if (!session) return { session, expectedSession, behindTradingDays: 0, stale: true };
  const behindTradingDays = tradingDaysBetween(session, expectedSession);
  return { session, expectedSession, behindTradingDays, stale: behindTradingDays > 0 };
}

/** The site-wide stale warning, e.g. 「資料停在 11/14（五），最新應為 11/17（二）· 落後 1 個交易日」. */
export function staleText(f: Freshness): string | null {
  if (!f.stale) return null;
  if (!f.session) return `尚無收盤資料，最新應為 ${mmddWeekday(f.expectedSession)}`;
  return `資料停在 ${mmddWeekday(f.session)}，最新應為 ${mmddWeekday(f.expectedSession)} · 落後 ${f.behindTradingDays} 個交易日`;
}
