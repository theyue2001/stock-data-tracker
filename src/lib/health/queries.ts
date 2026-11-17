import { db } from "@/lib/db";
import { DATASETS } from "@/lib/jobs/run-log";
import { calendarCovers, expectedLatestSession, marketPhase, sessionString, taipeiNow, type MarketPhase } from "@/lib/market-session";
import {
  INTRADAY_DATASET,
  INTRADAY_STALE_POLLS,
  activeGroups,
  datasetHealth,
  datasetKind,
  healthConfigFromEnv,
  overallHealth,
  publicHealth,
  redactSecrets,
  worstStatus,
  type DatasetHealth,
  type DatasetKind,
  type HealthConfig,
  type IntradayTick,
  type OverallHealth,
  type PublicHealth,
} from "./status";

/**
 * Reads for the admin data-health page and the public /api/health summary.
 *
 * Deliberately uncached (no "use cache"): the whole point is to show the
 * database as it is right now, and both callers run per request. Inputs are
 * gathered here; every verdict comes from the pure rules in ./status.ts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back to look for (dataset, provider) groups and their last success. */
export const LOOKBACK_DAYS = 30;
/** Failure history window. */
export const FAILURE_HISTORY_DAYS = 14;
export const FAILURE_HISTORY_LIMIT = 100;
export const RECENT_RUNS_LIMIT = 50;
/**
 * A JobRun still `running` this long after it started almost certainly died
 * without reaching finish() — a serverless timeout kills the function, not
 * just the step — so it is shown as stalled and listed with the failures.
 */
export const RUNNING_STALE_MINUTES = 15;

export const DATASET_LABEL: Record<string, string> = {
  "market-status": "大盤收盤",
  prices: "個股日行情",
  fundamentals: "營收／EPS",
  catalysts: "重大訊息",
  flows: "法人買賣超",
  indicators: "領先指標",
  technicals: "技術指標",
  scores: "產業熱度分數",
  sentiment: "產業氣氛",
  alerts: "警示",
  brief: "每日簡報",
  "intraday-index": "盤中加權指數",
  verify: "來源檢查",
};

const DATASET_ORDER: readonly string[] = Object.values(DATASETS);

export interface AttemptView {
  status: string;
  session: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  received: number;
  persisted: number;
  expected: number | null;
  httpStatus: number | null;
  error: string | null;
  sourceAsOf: Date | null;
}

export interface DatasetRow {
  /** Unique per row (dataset + provider). */
  id: string;
  dataset: string;
  label: string;
  kind: DatasetKind;
  provider: string | null;
  providerName: string | null;
  providerUrl: string | null;
  /** False when no attempt was logged inside the lookback window. */
  attempted: boolean;
  latest: AttemptView | null;
  latestSuccess: { session: string | null; finishedAt: Date | null } | null;
  newestSuccessSession: string | null;
  health: DatasetHealth;
}

export interface DatasetRunView {
  id: string;
  dataset: string;
  label: string;
  provider: string | null;
  providerName: string | null;
  session: string | null;
  status: string;
  received: number;
  persisted: number;
  expected: number | null;
  httpStatus: number | null;
  error: string | null;
  durationMs: number | null;
}

export interface RunView {
  id: string;
  job: string;
  trigger: string;
  session: string | null;
  status: string;
  /** `running` for longer than RUNNING_STALE_MINUTES. */
  stalled: boolean;
  reason: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  datasets: DatasetRunView[];
}

export interface IntradaySection {
  tick: IntradayTick | null;
  health: DatasetHealth;
  /** intraday-index attempts since Taipei midnight, by status. */
  today: Record<string, number>;
  staleAfterSeconds: number;
}

export interface DataHealthReport {
  checkedAt: Date;
  phase: MarketPhase;
  latestSession: string | null;
  /** Every dataset row counted, plus whether the stored session is current. */
  overall: OverallHealth;
  /** Exactly what GET /api/health answers right now. */
  publicVerdict: PublicHealth;
  calendar: { year: number; covered: boolean; nextYear: number; nextCovered: boolean; december: boolean };
  config: HealthConfig;
  hasRuns: boolean;
  datasets: DatasetRow[];
  intraday: IntradaySection;
  recentRuns: RunView[];
  failures: RunView[];
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Raw reads
// ---------------------------------------------------------------------------

interface AttemptRow {
  dataset: string;
  provider: string | null;
  session: Date | null;
  status: string;
  received: number;
  persisted: number;
  expected: number | null;
  httpStatus: number | null;
  error: string | null;
  sourceAsOf: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}

const groupKey = (dataset: string, provider: string | null) => `${dataset}\u0000${provider ?? ""}`;
const dateOrNull = (d: Date | null) => (d ? sessionString(d) : null);
const textOrNull = (s: string | null) => (s ? redactSecrets(s) : null);

/**
 * Per (dataset, provider): the newest attempt, the newest success, the
 * newest session any success covers, and the newest attempt's status for the
 * expected session. DISTINCT ON keeps this four small queries however many
 * rows the minute-cadence intraday collector has logged.
 *
 * Timestamps go in as ISO text cast to `timestamp`: the columns are
 * timestamp-without-zone holding UTC, and a text cast drops the trailing Z
 * instead of shifting by the session's TimeZone the way a timestamptz
 * parameter would.
 */
async function readGroups(now: Date, expectedSession: string) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const expectedKey = `${expectedSession}T00:00:00.000Z`;
  const [latest, successes, coverage, forExpected] = await Promise.all([
    db.$queryRaw<AttemptRow[]>`
      SELECT DISTINCT ON ("dataset", "provider")
        "dataset", "provider", "session", "status", "received", "persisted", "expected",
        "httpStatus", "error", "sourceAsOf", "startedAt", "finishedAt", "durationMs"
      FROM "dataset_runs"
      WHERE "startedAt" >= ${since}::timestamp
      ORDER BY "dataset", "provider", "startedAt" DESC`,
    db.$queryRaw<{ dataset: string; provider: string | null; session: Date | null; startedAt: Date; finishedAt: Date | null }[]>`
      SELECT DISTINCT ON ("dataset", "provider") "dataset", "provider", "session", "startedAt", "finishedAt"
      FROM "dataset_runs"
      WHERE "status" = 'success' AND "startedAt" >= ${since}::timestamp
      ORDER BY "dataset", "provider", "startedAt" DESC`,
    db.$queryRaw<{ dataset: string; provider: string | null; session: Date | null }[]>`
      SELECT "dataset", "provider", MAX("session") AS "session"
      FROM "dataset_runs"
      WHERE "status" = 'success' AND "startedAt" >= ${since}::timestamp
      GROUP BY "dataset", "provider"`,
    db.$queryRaw<{ dataset: string; provider: string | null; status: string }[]>`
      SELECT DISTINCT ON ("dataset", "provider") "dataset", "provider", "status"
      FROM "dataset_runs"
      WHERE "session" = ${expectedKey}::timestamp
      ORDER BY "dataset", "provider", "startedAt" DESC`,
  ]);
  return {
    latest,
    success: new Map(successes.map((r) => [groupKey(r.dataset, r.provider), r])),
    coverage: new Map(coverage.map((r) => [groupKey(r.dataset, r.provider), dateOrNull(r.session)])),
    forExpected: new Map(forExpected.map((r) => [groupKey(r.dataset, r.provider), r.status])),
  };
}

async function readLatestSession(): Promise<string | null> {
  const row = await db.marketStatus.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  return row ? sessionString(row.date) : null;
}

async function readTick(): Promise<IntradayTick | null> {
  const row = await db.intradayIndex.findFirst({
    where: { index: "TAIEX" },
    orderBy: { date: "desc" },
    select: { date: true, tickAt: true, updatedAt: true },
  });
  return row ? { date: sessionString(row.date), tickAt: row.tickAt, updatedAt: row.updatedAt } : null;
}

async function readProviders(): Promise<Map<string, { name: string; url: string | null }>> {
  const rows = await db.dataSource.findMany({ select: { key: true, name: true, url: true } });
  return new Map(rows.map((r) => [r.key, { name: r.name, url: r.url }]));
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

async function buildDatasetRows(now: Date, config: HealthConfig, tick: IntradayTick | null): Promise<DatasetRow[]> {
  const expectedSession = expectedLatestSession(now);
  const [groups, providers] = await Promise.all([readGroups(now, expectedSession), readProviders()]);
  const active = activeGroups(groups.latest.map((r) => ({ ...r, latestAttemptAt: r.startedAt })));

  // Every known dataset gets a row even with nothing logged, so a step the
  // pipeline silently stopped running is visible as missing, not absent.
  const order = [...DATASET_ORDER, ...new Set(active.map((g) => g.dataset).filter((d) => !DATASET_ORDER.includes(d)))];
  const rows: DatasetRow[] = [];

  for (const dataset of order) {
    const forDataset = active.filter((g) => g.dataset === dataset).sort((a, b) => (a.provider ?? "").localeCompare(b.provider ?? ""));
    const entries = forDataset.length > 0 ? forDataset : [null];
    for (const g of entries) {
      const provider = g?.provider ?? null;
      const key = groupKey(dataset, provider);
      const success = g ? groups.success.get(key) : undefined;
      const latest: AttemptView | null = g
        ? {
            status: g.status,
            session: dateOrNull(g.session),
            startedAt: g.startedAt,
            finishedAt: g.finishedAt,
            durationMs: g.durationMs,
            received: g.received,
            persisted: g.persisted,
            expected: g.expected,
            httpStatus: g.httpStatus,
            error: textOrNull(g.error),
            sourceAsOf: g.sourceAsOf,
          }
        : null;
      const latestSuccess = success ? { session: dateOrNull(success.session), startedAt: success.startedAt, finishedAt: success.finishedAt } : null;
      const newestSuccessSession = g ? (groups.coverage.get(key) ?? null) : null;
      const health = datasetHealth(
        {
          dataset,
          latest,
          latestSuccess,
          newestSuccessSession,
          expectedSessionStatus: g ? (groups.forExpected.get(key) ?? null) : null,
          tick: dataset === INTRADAY_DATASET ? tick : undefined,
        },
        now,
        config,
      );
      const source = provider ? providers.get(provider) : undefined;
      rows.push({
        id: key,
        dataset,
        label: DATASET_LABEL[dataset] ?? dataset,
        kind: datasetKind(dataset),
        provider,
        providerName: source?.name ?? null,
        providerUrl: source?.url ?? null,
        attempted: g !== null,
        latest,
        latestSuccess: latestSuccess ? { session: latestSuccess.session, finishedAt: latestSuccess.finishedAt } : null,
        newestSuccessSession,
        health,
      });
    }
  }
  return rows;
}

function toRunView(
  run: {
    id: string;
    job: string;
    trigger: string;
    session: Date | null;
    status: string;
    reason: string | null;
    error: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    datasets: {
      id: string;
      dataset: string;
      provider: string | null;
      session: Date | null;
      status: string;
      received: number;
      persisted: number;
      expected: number | null;
      httpStatus: number | null;
      error: string | null;
      durationMs: number | null;
    }[];
  },
  now: Date,
  providers: Map<string, { name: string; url: string | null }>,
): RunView {
  return {
    id: run.id,
    job: run.job,
    trigger: run.trigger,
    session: dateOrNull(run.session),
    status: run.status,
    stalled: run.status === "running" && now.getTime() - run.startedAt.getTime() > RUNNING_STALE_MINUTES * 60 * 1000,
    reason: textOrNull(run.reason),
    error: textOrNull(run.error),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    datasets: run.datasets.map((d) => ({
      id: d.id,
      dataset: d.dataset,
      label: DATASET_LABEL[d.dataset] ?? d.dataset,
      provider: d.provider,
      providerName: d.provider ? (providers.get(d.provider)?.name ?? null) : null,
      session: dateOrNull(d.session),
      status: d.status,
      received: d.received,
      persisted: d.persisted,
      expected: d.expected,
      httpStatus: d.httpStatus,
      error: textOrNull(d.error),
      durationMs: d.durationMs,
    })),
  };
}

/** Rows as the overall verdict sees them. A stored intraday tick is evidence
 *  on its own, even before the collector logs DatasetRuns. */
function verdictDatasets(rows: DatasetRow[], tick: IntradayTick | null) {
  return rows.map((d) => ({
    dataset: d.dataset,
    status: d.health.status,
    attempted: d.attempted || (d.dataset === INTRADAY_DATASET && tick !== null),
  }));
}

/** Taipei midnight of `now`, as an instant. */
function taipeiMidnight(now: Date): Date {
  return new Date(`${taipeiNow(now).date}T00:00:00+08:00`);
}

export async function getDataHealthReport(now: Date = new Date()): Promise<DataHealthReport> {
  const config = healthConfigFromEnv();
  const failureSince = new Date(now.getTime() - FAILURE_HISTORY_DAYS * DAY_MS);
  const stalledBefore = new Date(now.getTime() - RUNNING_STALE_MINUTES * 60 * 1000);
  const failureWhere = {
    startedAt: { gte: failureSince },
    OR: [{ status: { in: ["failed", "partial"] } }, { status: "running", startedAt: { lt: stalledBefore } }],
  };
  const runInclude = {
    datasets: {
      orderBy: { startedAt: "asc" as const },
      select: {
        id: true,
        dataset: true,
        provider: true,
        session: true,
        status: true,
        received: true,
        persisted: true,
        expected: true,
        httpStatus: true,
        error: true,
        durationMs: true,
      },
    },
  };

  const [latestSession, tick, firstRun, providers, recent, failures, failureCount, todayIntraday] = await Promise.all([
    readLatestSession(),
    readTick(),
    db.jobRun.findFirst({ select: { id: true } }),
    readProviders(),
    // The intraday collector logs a run every minute of the session; listed
    // here it would push every pipeline run off the page. Its own section
    // and the failure history below still cover it.
    db.jobRun.findMany({ where: { job: { not: "intraday" } }, orderBy: { startedAt: "desc" }, take: RECENT_RUNS_LIMIT, include: runInclude }),
    db.jobRun.findMany({ where: failureWhere, orderBy: { startedAt: "desc" }, take: FAILURE_HISTORY_LIMIT, include: runInclude }),
    db.jobRun.count({ where: failureWhere }),
    db.datasetRun.groupBy({
      by: ["status"],
      where: { dataset: INTRADAY_DATASET, startedAt: { gte: taipeiMidnight(now) } },
      _count: { _all: true },
    }),
  ]);
  const datasets = await buildDatasetRows(now, config, tick);

  const intradayRows = datasets.filter((d) => d.dataset === INTRADAY_DATASET);
  const intradayHealth = intradayRows.reduce<DatasetHealth>(
    (worst, r) => (worstStatus([worst.status, r.health.status]) === worst.status ? worst : r.health),
    intradayRows[0].health,
  );
  const verdictInput = { latestSession, datasets: verdictDatasets(datasets, tick) };
  const year = Number(taipeiNow(now).date.slice(0, 4));

  return {
    checkedAt: now,
    phase: marketPhase(now),
    latestSession,
    overall: overallHealth(verdictInput, now),
    publicVerdict: publicHealth({ ...verdictInput, tick }, now),
    calendar: {
      year,
      covered: calendarCovers(year),
      nextYear: year + 1,
      nextCovered: calendarCovers(year + 1),
      december: taipeiNow(now).date.slice(5, 7) === "12",
    },
    config,
    hasRuns: firstRun !== null,
    datasets,
    intraday: {
      tick,
      health: intradayHealth,
      today: Object.fromEntries(todayIntraday.map((g) => [g.status, g._count._all])),
      staleAfterSeconds: config.intradayIntervalSeconds * INTRADAY_STALE_POLLS,
    },
    recentRuns: recent.map((r) => toRunView(r, now, providers)),
    failures: failures.map((r) => toRunView(r, now, providers)),
    failureCount,
  };
}

/** The anonymous /api/health body. */
export async function getPublicHealth(now: Date = new Date()): Promise<PublicHealth> {
  const config = healthConfigFromEnv();
  const [latestSession, tick] = await Promise.all([readLatestSession(), readTick()]);
  const datasets = await buildDatasetRows(now, config, tick);
  return publicHealth({ latestSession, tick, datasets: verdictDatasets(datasets, tick) }, now);
}
