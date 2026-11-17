/**
 * The live snapshot every open dashboard tab polls from GET /api/live, and
 * the "data stamp" each server render carries so the tab can tell when the
 * page it is showing has fallen behind the database.
 *
 * Pure: the database reads live in ./sources.ts. Relative imports only, so
 * `npm test` can load this file through tsx without the `@/` alias.
 */
import { marketPhase, type MarketPhase } from "../market-session";
import { DEFAULT_INTRADAY_INTERVAL_SECONDS, describeTaiex, freshness, type TaiexKind } from "./labels";

/** Newest stored intraday TAIEX row, serialised. */
export interface IntradayRow {
  date: string;
  last: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  tickAt: string;
  updatedAt: string;
  isMock: boolean;
}

/** What the after-hours side of the database currently holds. */
export interface DataSources {
  /** Newest MarketStatus (TAIEX close, turnover, market-wide flows) row. */
  market: { session: string; isMock: boolean; createdAt: string } | null;
  /** Newest session with any per-stock MarketData row. */
  pricesSession: string | null;
  /** Newest finished, successful (or partial) run of a job that writes after-hours data. */
  lastRun: { id: string; finishedAt: string } | null;
}

export interface LiveSources extends DataSources {
  intraday: IntradayRow | null;
}

/** Rendered into every page (via the root layout) and compared against /api/live. */
export interface DataStamp {
  marketSession: string | null;
  pricesSession: string | null;
  /** The older of the two — the newest session for which the dashboard is complete. */
  session: string | null;
  /** When after-hours data last landed (newest finished job, else the newest close row's insert), ISO. */
  lastUpdatedAt: string | null;
  /** Newest MarketStatus row is demo data. */
  isMock: boolean;
  /** Changes whenever a stored session or a finished data-writing job changes. */
  dataVersion: string;
}

export interface LiveSnapshot {
  generatedAt: string;
  phase: MarketPhase;
  /** Session whose after-hours close should already be out (see expectedLatestSession). */
  expectedSession: string;
  /** Poll interval of the intraday job; the 即時 window is twice this. */
  intervalSeconds: number;
  close: {
    session: string | null;
    marketSession: string | null;
    pricesSession: string | null;
    behindTradingDays: number;
    stale: boolean;
    lastUpdatedAt: string | null;
  };
  /** The intraday TAIEX tick, only while it is newer than the newest stored close. */
  intraday: {
    last: number;
    change: number;
    changePct: number;
    high: number;
    low: number;
    tickDate: string;
    tickAt: string;
    updatedAt: string;
    ageSeconds: number;
    kind: TaiexKind;
    isMock: boolean;
  } | null;
  /** The after-hours part of `version`. A tab whose rendered stamp differs re-fetches the page. */
  dataVersion: string;
  /** Changes whenever anything the dashboard shows changes, intraday tick included. */
  version: string;
}

/** FNV-1a, 32-bit, base36 — an opaque, stable version token, not a security hash. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

function olderOf(a: string | null, b: string | null): string | null {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

export function dataStampOf(s: DataSources): DataStamp {
  const marketSession = s.market?.session ?? null;
  return {
    marketSession,
    pricesSession: s.pricesSession,
    session: olderOf(marketSession, s.pricesSession),
    lastUpdatedAt: s.lastRun?.finishedAt ?? s.market?.createdAt ?? null,
    isMock: s.market?.isMock ?? false,
    dataVersion: fnv1a(`${marketSession}|${s.pricesSession}|${s.lastRun?.id ?? ""}|${s.lastRun?.finishedAt ?? ""}`),
  };
}

/**
 * INTRADAY_INTERVAL_SECONDS is the intraday poller's cadence (default 60).
 * Read here only to size the 即時 window. Clamped the same way the collector
 * clamps it for the MIS source (never below 60 s — it is a public quote
 * page, not a licensed feed): a smaller value here than the collector
 * actually uses would flip every healthy tick to 延遲 between polls.
 * Anything that is not a number falls back to the default.
 */
export function intradayIntervalSeconds(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.INTRADAY_INTERVAL_SECONDS);
  if (!env.INTRADAY_INTERVAL_SECONDS || !Number.isFinite(n)) return DEFAULT_INTRADAY_INTERVAL_SECONDS;
  return Math.max(DEFAULT_INTRADAY_INTERVAL_SECONDS, Math.round(n));
}

export function buildLiveSnapshot(s: LiveSources, now: Date, intervalSeconds: number): LiveSnapshot {
  const stamp = dataStampOf(s);
  const f = freshness(stamp.session, now);

  const label = s.intraday
    ? describeTaiex(
        {
          closeSession: stamp.marketSession,
          intraday: { date: s.intraday.date, tickAt: s.intraday.tickAt, updatedAt: s.intraday.updatedAt },
          intervalSeconds,
        },
        now,
      )
    : null;

  const intraday =
    s.intraday && label?.source === "intraday" && label.kind
      ? {
          last: s.intraday.last,
          change: s.intraday.change,
          changePct: s.intraday.changePct,
          high: s.intraday.high,
          low: s.intraday.low,
          tickDate: s.intraday.date,
          tickAt: s.intraday.tickAt,
          updatedAt: s.intraday.updatedAt,
          ageSeconds: label.ageSeconds ?? 0,
          kind: label.kind,
          isMock: s.intraday.isMock,
        }
      : null;

  return {
    generatedAt: now.toISOString(),
    phase: marketPhase(now),
    expectedSession: f.expectedSession,
    intervalSeconds,
    close: {
      session: stamp.session,
      marketSession: stamp.marketSession,
      pricesSession: stamp.pricesSession,
      behindTradingDays: f.behindTradingDays,
      stale: f.stale,
      lastUpdatedAt: stamp.lastUpdatedAt,
    },
    intraday,
    dataVersion: stamp.dataVersion,
    version: fnv1a(`${stamp.dataVersion}|${s.intraday?.date ?? ""}|${s.intraday?.updatedAt ?? ""}`),
  };
}
