/**
 * Data-health verdicts as pure functions of "what the job log says" and
 * "what time it is".
 *
 * No database access in this file, so every rule is unit-tested
 * (status.test.ts) and the admin page, the public /api/health summary and any
 * future alerting judge freshness identically. The query layer
 * (./queries.ts) only gathers inputs.
 *
 * One rule runs through all of it: a dataset is never called healthy without
 * a success row (or, for the intraday tick, the stored tick itself) proving
 * it. "Nothing failed" is not the same as "the data is there".
 */
import type { DatasetKey, DatasetStatus } from "../jobs/run-log";
import {
  CLOSE_PUBLISHED_MIN,
  SESSION_CLOSE_MIN,
  SESSION_OPEN_MIN,
  expectedLatestSession,
  marketPhase,
  previousTradingDay,
  taipeiNow,
  tradingDayOnOrBefore,
  type MarketPhase,
} from "../market-session";

export type HealthStatus = "healthy" | "waiting" | "delayed" | "failed";

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: "正常",
  waiting: "等待發布",
  delayed: "延遲",
  failed: "失敗",
};

const SEVERITY: Record<HealthStatus, number> = { healthy: 0, waiting: 1, delayed: 2, failed: 3 };

export function worstStatus(statuses: Iterable<HealthStatus>): HealthStatus {
  let worst: HealthStatus = "healthy";
  for (const s of statuses) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

// ---------------------------------------------------------------------------
// Dataset kinds
// ---------------------------------------------------------------------------

/** Datasets that describe one market session and must exist for every trading day. */
export const SESSION_DATASETS = [
  "market-status",
  "prices",
  "flows",
  "technicals",
  "scores",
  "sentiment",
  "alerts",
  "brief",
] as const satisfies readonly DatasetKey[];

/** Datasets refreshed on their own cadence (monthly revenue, announcements,
 *  external indicators, source probes) rather than once per session. */
export const PERIODIC_DATASETS = ["fundamentals", "catalysts", "indicators", "verify"] as const satisfies readonly DatasetKey[];

export const INTRADAY_DATASET = "intraday-index" satisfies DatasetKey;

/**
 * What the public /api/health treats as "the site's data": the session close,
 * the per-stock prices and the three things every screen derives from them.
 * A failure or delay in any of these turns the endpoint 503. Alerts, the
 * brief, the periodic sources and the intraday tick show on the admin page
 * but never page an uptime monitor.
 */
export const REQUIRED_DATASETS = ["market-status", "prices", "flows", "scores", "sentiment"] as const satisfies readonly DatasetKey[];

export type DatasetKind = "session" | "intraday" | "periodic";

const SESSION_SET = new Set<string>(SESSION_DATASETS);

/** Unknown dataset names (added by a later job) fall back to the periodic
 *  rule — the most lenient one that still requires a recent success. */
export function datasetKind(dataset: string): DatasetKind {
  if (dataset === INTRADAY_DATASET) return "intraday";
  return SESSION_SET.has(dataset) ? "session" : "periodic";
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * When a missing session becomes "late" for the close-based datasets
 * (market-status, prices, technicals), in minutes after Taipei midnight.
 * The whole-market close is normally out by ~16:10 (see CLOSE_PUBLISHED_MIN);
 * 18:00 leaves the pipeline's polls about two hours of retries before a
 * session that simply has not landed yet is reported as delayed.
 */
export const DEFAULT_SESSION_DEADLINE_MIN = 18 * 60;

/** Default for PIPELINE_FLOW_DEADLINE: per-stock institutional flows (T86)
 *  publish in the evening, well after the close. */
export const DEFAULT_FLOW_DEADLINE_MIN = 21 * 60;

/** Datasets computed from flows. The pipeline may hold them until flows land,
 *  so they are not late before the flow deadline either. */
const FLOW_DEPENDENT = new Set<string>(["scores", "sentiment", "alerts", "brief"]);

/** Default for INTRADAY_INTERVAL_SECONDS: the collector's poll cadence. */
export const DEFAULT_INTRADAY_INTERVAL_SECONDS = 60;

/** The collector clamps its MIS poll interval to at least this; a smaller
 *  env value must not shrink the staleness threshold below what it really does. */
export const MIN_INTRADAY_INTERVAL_SECONDS = 60;

/** Missed polls before the intraday tick counts as stale during the session. */
export const INTRADAY_STALE_POLLS = 3;

/**
 * A tick stamped at or after this minute means the collector ran through the
 * session. The closing call auction runs 13:25–13:30; a collector polling
 * once a minute can stop just before the 13:30:00 print, so demanding that
 * exact print would flag a working collector every evening.
 */
export const INTRADAY_SESSION_END_TICK_MIN = 13 * 60 + 25;

/** fundamentals / catalysts / indicators / verify: healthy when a run
 *  succeeded on one of the last N trading days (today included). */
export const PERIODIC_SUCCESS_TRADING_DAYS = 2;

export interface HealthConfig {
  /** PIPELINE_FLOW_DEADLINE, minutes after Taipei midnight. */
  flowDeadlineMin: number;
  /** INTRADAY_INTERVAL_SECONDS. */
  intradayIntervalSeconds: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  flowDeadlineMin: DEFAULT_FLOW_DEADLINE_MIN,
  intradayIntervalSeconds: DEFAULT_INTRADAY_INTERVAL_SECONDS,
};

/** "21:00" → 1260. Null for anything that is not a valid HH:MM. */
export function parseClockMinutes(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Reads the two tunables. A malformed value falls back to the default
 *  rather than failing the page — the health page must render precisely
 *  when something is misconfigured. */
export function healthConfigFromEnv(env: Record<string, string | undefined> = process.env): HealthConfig {
  const interval = Number(env.INTRADAY_INTERVAL_SECONDS);
  return {
    flowDeadlineMin: parseClockMinutes(env.PIPELINE_FLOW_DEADLINE) ?? DEFAULT_FLOW_DEADLINE_MIN,
    intradayIntervalSeconds:
      Number.isFinite(interval) && interval > 0 ? Math.max(MIN_INTRADAY_INTERVAL_SECONDS, interval) : DEFAULT_INTRADAY_INTERVAL_SECONDS,
  };
}

/** Minute of the Taipei day after which a missing session is late. */
export function sessionDeadlineMin(dataset: string, config: HealthConfig = DEFAULT_HEALTH_CONFIG): number {
  if (dataset === "flows") return config.flowDeadlineMin;
  if (FLOW_DEPENDENT.has(dataset)) return Math.max(DEFAULT_SESSION_DEADLINE_MIN, config.flowDeadlineMin);
  return DEFAULT_SESSION_DEADLINE_MIN;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trading days in (`latest`, `expected`] — how many sessions the stored data
 * is behind. 0 when it is current, null when nothing is stored.
 */
export function tradingDaysBehind(latest: string | null, expected: string): number | null {
  if (latest === null) return null;
  if (latest >= expected) return 0;
  let n = 0;
  // A year of sessions is far past any useful answer; the cap only stops a
  // corrupt date from spinning.
  for (let d = tradingDayOnOrBefore(expected); d > latest && n < 400; d = previousTradingDay(d)) n++;
  return n;
}

function clockParts(tickAt: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(tickAt.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** The instant of an exchange tick: a Taipei calendar date plus the
 *  exchange-reported "HH:MM:SS". Null when the time does not parse. */
export function tickInstant(date: string, tickAt: string): Date | null {
  const p = clockParts(tickAt);
  if (!p) return null;
  const [h, m, s] = p.map((x) => String(x).padStart(2, "0"));
  const d = new Date(`${date}T${h}:${m}:${s}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tickMinute(tickAt: string): number | null {
  const p = clockParts(tickAt);
  return p ? p[0] * 60 + p[1] : null;
}

function secondsBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// Per-dataset verdict
// ---------------------------------------------------------------------------

export interface AttemptSnapshot {
  /** A DatasetStatus; typed loosely so an unexpected value cannot crash the page. */
  status: DatasetStatus | (string & {});
  /** YYYY-MM-DD session the attempt targeted. */
  session: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface SuccessSnapshot {
  session: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface IntradayTick {
  /** Taipei calendar date, YYYY-MM-DD. */
  date: string;
  /** Exchange-reported "HH:MM:SS". */
  tickAt: string;
  /** When we last wrote the row. */
  updatedAt: Date;
}

export interface DatasetHealthInput {
  dataset: string;
  /** Newest attempt of any status. */
  latest: AttemptSnapshot | null;
  /** Newest success by time. */
  latestSuccess: SuccessSnapshot | null;
  /** Newest session any success covers (differs from latestSuccess.session
   *  after a backfill of an older session). */
  newestSuccessSession: string | null;
  /** Status of the newest attempt whose session is expectedLatestSession(now). */
  expectedSessionStatus: string | null;
  /** intraday-index only: the newest stored tick. */
  tick?: IntradayTick | null;
}

export interface DatasetHealth {
  status: HealthStatus;
  /** One line of Traditional Chinese saying why. */
  reason: string;
  /** Session datasets: the session that should be covered by now. */
  expectedSession: string | null;
  /** Session datasets: trading days the newest success is behind. */
  sessionsBehind: number | null;
  /** Intraday: tick age. Periodic: time since the last success. */
  ageSeconds: number | null;
  /** Session datasets: HH:MM after which a missing session is late. */
  deadline: string | null;
}

export function datasetHealth(input: DatasetHealthInput, now: Date, config: HealthConfig = DEFAULT_HEALTH_CONFIG): DatasetHealth {
  switch (datasetKind(input.dataset)) {
    case "session":
      return sessionHealth(input, now, config);
    case "intraday":
      return intradayHealth(input, now, config);
    default:
      return periodicHealth(input, now);
  }
}

function sessionHealth(input: DatasetHealthInput, now: Date, config: HealthConfig): DatasetHealth {
  const expected = expectedLatestSession(now);
  const deadlineMin = sessionDeadlineMin(input.dataset, config);
  // The newest session that must be covered by now. Equal to `expected`
  // once today's deadline has passed (and on non-trading days); the previous
  // trading day while today's session is still inside its publication window.
  const required = expectedLatestSession(now, Math.max(deadlineMin, CLOSE_PUBLISHED_MIN));
  const covered = input.newestSuccessSession;
  const behind = tradingDaysBehind(covered, expected);
  const deadline = clockLabel(deadlineMin);
  const base = { expectedSession: expected, sessionsBehind: behind, ageSeconds: null, deadline };

  if (input.latest?.status === "failed") return { ...base, status: "failed", reason: "最近一次執行失敗" };
  if (covered !== null && covered >= expected) return { ...base, status: "healthy", reason: `已涵蓋 ${expected}` };
  if (input.expectedSessionStatus === "partial") {
    return { ...base, status: "delayed", reason: `${expected} 只取得部分資料` };
  }
  // Only the newest session is missing and its deadline has not passed: the
  // source is still inside its normal publication window. Whether the
  // pipeline already asked (and recorded `waiting`) or has not polled yet,
  // nothing is late.
  if (required !== expected && covered !== null && covered >= required) {
    return {
      ...base,
      status: "waiting",
      reason:
        input.expectedSessionStatus === "waiting"
          ? `來源尚未發布 ${expected}，${deadline} 前持續重試`
          : `${expected} 尚未取得，${deadline} 前不算延遲`,
    };
  }
  if (covered === null) {
    return { ...base, status: "delayed", reason: input.latest ? "查詢期間內沒有成功紀錄" : "查詢期間內沒有執行紀錄" };
  }
  if (input.expectedSessionStatus === "waiting") {
    return { ...base, status: "delayed", reason: `已過 ${deadline} 來源仍未發布 ${expected}` };
  }
  return { ...base, status: "delayed", reason: `落後 ${behind} 個交易日（最新 ${covered}）` };
}

function intradayHealth(input: DatasetHealthInput, now: Date, config: HealthConfig): DatasetHealth {
  const thresholdSec = config.intradayIntervalSeconds * INTRADAY_STALE_POLLS;
  const t = taipeiNow(now);
  const phase = marketPhase(now);
  const tick = input.tick ?? null;
  const tickTime = tick ? (tickInstant(tick.date, tick.tickAt) ?? tick.updatedAt) : null;
  const age = tickTime ? secondsBetween(now, tickTime) : null;
  const lastFailed = input.latest?.status === "failed";
  const base = { expectedSession: null, sessionsBehind: null, ageSeconds: age, deadline: null };
  const minutesSince = (min: number) => (t.minutes - min) * 60;

  // During the session — and for a few polls after the close, while the last
  // print is still arriving — judge by how old the newest tick is.
  if (phase === "open" || (phase === "post-close" && minutesSince(SESSION_CLOSE_MIN) < thresholdSec)) {
    if (age !== null && age < thresholdSec) return { ...base, status: "healthy", reason: "盤中報價持續更新" };
    if (phase === "open" && minutesSince(SESSION_OPEN_MIN) < thresholdSec && tick?.date !== t.date) {
      return { ...base, status: "waiting", reason: "等待開盤後第一筆報價" };
    }
    if (lastFailed) return { ...base, status: "failed", reason: "最近一次輪詢失敗" };
    // The collector logs `waiting` when the feed answers but has not traded
    // yet or still carries the previous session — the source, not us.
    if (input.latest?.status === "waiting") return { ...base, status: "waiting", reason: "來源尚未提供本交易日報價" };
    if (!tick) return { ...base, status: "delayed", reason: "尚無盤中資料" };
    return { ...base, status: "delayed", reason: `報價已超過 ${INTRADAY_STALE_POLLS} 個輪詢週期未更新` };
  }

  // Outside the session an old tick is expected, so age is not judged. The
  // question is only whether the collector covered the latest session
  // through the close.
  const session = phase === "post-close" ? t.date : phase === "pre-open" ? previousTradingDay(t.date) : tradingDayOnOrBefore(t.date);
  const endMinute = tick ? tickMinute(tick.tickAt) : null;
  if (tick && tick.date >= session && endMinute !== null && endMinute >= INTRADAY_SESSION_END_TICK_MIN) {
    return { ...base, status: "healthy", reason: `已有 ${tick.date} 收盤前後報價` };
  }
  if (lastFailed) return { ...base, status: "failed", reason: "最近一次輪詢失敗" };
  if (!tick) return { ...base, status: "delayed", reason: "尚無盤中資料" };
  if (tick.date >= session) return { ...base, status: "delayed", reason: `${session} 報價停在 ${tick.tickAt}，未涵蓋收盤` };
  return { ...base, status: "delayed", reason: `缺少 ${session} 盤中報價` };
}

function periodicHealth(input: DatasetHealthInput, now: Date): DatasetHealth {
  let windowStart = tradingDayOnOrBefore(taipeiNow(now).date);
  for (let i = 1; i < PERIODIC_SUCCESS_TRADING_DAYS; i++) windowStart = previousTradingDay(windowStart);
  const success = input.latestSuccess;
  const successAt = success ? (success.finishedAt ?? success.startedAt) : null;
  const successDay = successAt ? taipeiNow(successAt).date : null;
  const base = { expectedSession: null, sessionsBehind: null, ageSeconds: successAt ? secondsBetween(now, successAt) : null, deadline: null };

  if (input.latest?.status === "failed") return { ...base, status: "failed", reason: "最近一次執行失敗" };
  if (successDay !== null && successDay >= windowStart) return { ...base, status: "healthy", reason: `${successDay} 執行成功` };
  if (input.latest?.status === "waiting") return { ...base, status: "waiting", reason: "來源尚未發布新資料" };
  if (successDay === null) {
    return { ...base, status: "delayed", reason: input.latest ? "查詢期間內沒有成功紀錄" : "查詢期間內沒有執行紀錄" };
  }
  return {
    ...base,
    status: "delayed",
    reason: `最近 ${PERIODIC_SUCCESS_TRADING_DAYS} 個交易日沒有成功執行（最後成功 ${successDay}）`,
  };
}

// ---------------------------------------------------------------------------
// Dataset groups
// ---------------------------------------------------------------------------

/** A provider stops counting for its dataset once another provider of the
 *  same dataset has run this long after it last did — a DATA_MODE switch or
 *  a one-off fallback source, not a broken feed. */
export const RETIRED_PROVIDER_HOURS = 24;

/**
 * Which (dataset, provider) groups to judge. Without this, switching from
 * mock to live data would leave the old mock provider reported as delayed
 * (and /api/health returning 503) until it aged out of the lookback window.
 */
export function activeGroups<T extends { dataset: string; latestAttemptAt: Date }>(groups: readonly T[]): T[] {
  const newest = new Map<string, number>();
  for (const g of groups) newest.set(g.dataset, Math.max(newest.get(g.dataset) ?? 0, g.latestAttemptAt.getTime()));
  const cutoffMs = RETIRED_PROVIDER_HOURS * 3600 * 1000;
  return groups.filter((g) => (newest.get(g.dataset) ?? 0) - g.latestAttemptAt.getTime() <= cutoffMs);
}

// ---------------------------------------------------------------------------
// Overall verdict
// ---------------------------------------------------------------------------

export interface OverallInput {
  /** Newest stored session (MarketStatus), YYYY-MM-DD. */
  latestSession: string | null;
  /** `attempted`: a job logged this dataset inside the lookback window (for
   *  the intraday tick, a stored tick counts too). */
  datasets: readonly { dataset: string; status: HealthStatus; attempted: boolean }[];
}

export interface OverallHealth {
  status: HealthStatus;
  ok: boolean;
  expectedSession: string;
  behindTradingDays: number | null;
  phase: MarketPhase;
}

/**
 * The worst of the given datasets plus whether the stored session itself is
 * current. Only datasets some job has actually logged count: one nothing has
 * ever recorded is unknown rather than broken (its row still says so), and
 * must not hold the verdict at 延遲 forever — the stored-session check
 * already catches a pipeline that is not running at all. With
 * `requiredOnly`, only REQUIRED_DATASETS count (the public endpoint).
 */
export function overallHealth(input: OverallInput, now: Date, opts: { requiredOnly?: boolean } = {}): OverallHealth {
  const expected = expectedLatestSession(now);
  const required = expectedLatestSession(now, DEFAULT_SESSION_DEADLINE_MIN);
  const requiredSet = new Set<string>(REQUIRED_DATASETS);
  const counted = input.datasets.filter((d) => d.attempted && (!opts.requiredOnly || requiredSet.has(d.dataset)));
  const statuses = counted.map((d) => d.status);
  if (input.latestSession === null || input.latestSession < required) statuses.push("delayed");
  else if (input.latestSession < expected) statuses.push("waiting");
  const status = worstStatus(statuses);
  return {
    status,
    ok: status === "healthy" || status === "waiting",
    expectedSession: expected,
    behindTradingDays: tradingDaysBehind(input.latestSession, expected),
    phase: marketPhase(now),
  };
}

export interface PublicHealth {
  ok: boolean;
  status: HealthStatus;
  latestSession: string | null;
  expectedSession: string;
  behindTradingDays: number | null;
  phase: MarketPhase;
  intraday: { tickDate: string; tickAt: string; ageSeconds: number | null } | null;
  checkedAt: string;
}

/** The /api/health body: verdict and freshness only — no error text, no
 *  provider names, nothing an anonymous caller could use. */
export function publicHealth(input: OverallInput & { tick: IntradayTick | null }, now: Date): PublicHealth {
  const overall = overallHealth(input, now, { requiredOnly: true });
  const tickTime = input.tick ? tickInstant(input.tick.date, input.tick.tickAt) : null;
  return {
    ok: overall.ok,
    status: overall.status,
    latestSession: input.latestSession,
    expectedSession: overall.expectedSession,
    behindTradingDays: overall.behindTradingDays,
    phase: overall.phase,
    intraday: input.tick
      ? { tickDate: input.tick.date, tickAt: input.tick.tickAt, ageSeconds: tickTime ? secondsBetween(now, tickTime) : null }
      : null,
    checkedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Display safety
// ---------------------------------------------------------------------------

/**
 * Masks credentials that can ride along in an error message: query-string
 * tokens (FinMind takes `?token=`), bearer headers echoed back, and
 * user:password in a connection string. The admin page is protected, but a
 * screenshot of it should still be safe to share.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&](?:token|api[_-]?key|apikey|key|secret|password|passwd|access_token|auth|signature|sig)=)[^&\s"'#]+/gi, "$1***")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/?#\s@]+:)[^@\s/]+@/gi, "$1***@");
}
