import { db } from "@/lib/db";
import { utcDay, utcDateKey } from "@/lib/dates";
import { dataMode } from "@/lib/providers/registry";
import { latestSessionDate } from "@/lib/providers/live/market-status-provider";
import { loadTrackedStocks } from "./persist";
import {
  refreshCatalysts,
  refreshFlows,
  refreshFundamentals,
  refreshIndicators,
  refreshMarketStatus,
  refreshPrices,
  refreshScores,
  refreshSentiment,
  refreshTechnicals,
  type SessionContext,
  type StepResult,
} from "./refresh-data";
import { evaluateAlerts } from "./generate-alerts";
import { runDailyBriefJob } from "./generate-daily-brief";
import {
  DATASETS,
  errorText,
  startJobRun,
  type DatasetKey,
  type DatasetRecord,
  type DatasetStatus,
  type JobName,
  type JobRunHandle,
  type JobTrigger,
  type RunStatus,
} from "./run-log";
import { alreadyRunningReason, withPipelineLock, type PipelineLockOptions } from "./pipeline-lock";
import {
  BEST_EFFORT_DATASETS,
  REQUIRED_DATASETS,
  executePlan,
  formatDeadline,
  mergeRun,
  parseDeadline,
  planRun,
  type PipelineDataset,
  type Plan,
  type PlanOptions,
  type PlanState,
  type StepTable,
} from "./session-plan";
import { latestScoredSession, latestStoredSession } from "./sessions";

export interface PipelineResult {
  status: RunStatus;
  /** YYYY-MM-DD session the run targeted, when known. */
  session: string | null;
  /** Set when the run did nothing (already complete, or another run holds the lock). */
  skippedReason: string | null;
  /** JobRun.id of this invocation, when it was logged. */
  jobRunId: string | null;
  /** True when anything was written, so the caller should expire the radar cache. */
  wroteData: boolean;
  /** Job-specific detail for the HTTP response / CLI output. */
  summary: unknown;
}

export interface PipelineOptions {
  trigger: JobTrigger;
  /** "daily" (default) runs every dataset; "refresh" stops before alerts and the brief. */
  job?: "daily" | "refresh";
  /** Re-run every dataset of the session once, even ones already complete (manual repair). */
  force?: boolean;
  /** Lease options; CLI callers pass a heartbeat so a long run keeps the lock. */
  lock?: PipelineLockOptions;
}

/** Default for PIPELINE_FLOW_DEADLINE: stop waiting for T86 at 21:00 Taipei. */
const DEFAULT_FLOW_DEADLINE_MIN = 21 * 60;
/** A failed best-effort dataset (revenue, filings, indicators) is retried at most hourly. */
const BEST_EFFORT_RETRY_MS = 60 * 60_000;
/** Market-status detail (breadth, BFI82U, MI_MARGN) still missing: re-asked every 30 minutes, not every poll. */
const DETAIL_RETRY_MS = 30 * 60_000;

export function pipelinePlanOptions(): PlanOptions {
  const raw = process.env.PIPELINE_FLOW_DEADLINE;
  const parsed = parseDeadline(raw);
  if (raw && parsed === null) {
    console.warn(`[pipeline] PIPELINE_FLOW_DEADLINE="${raw}" is not HH:MM (Asia/Taipei); using ${formatDeadline(DEFAULT_FLOW_DEADLINE_MIN)}`);
  }
  return {
    flowDeadlineMin: parsed ?? DEFAULT_FLOW_DEADLINE_MIN,
    bestEffortRetryMs: BEST_EFFORT_RETRY_MS,
    detailRetryMs: DETAIL_RETRY_MS,
  };
}

/**
 * The after-hours pipeline for the newest published session — the single
 * entry point shared by /api/jobs/daily, /api/jobs/refresh,
 * scripts/run-daily.ts, scripts/run-refresh.ts and the long-running scheduler
 * in scripts/cron.ts, so every caller gets the same planning, locking and
 * logging.
 *
 * Built to be polled every 5 minutes from 13:30 to midnight:
 *  - each poll runs only what is still missing for the session (session-plan.ts),
 *    so a poll with nothing to do costs one request to ask which session is
 *    published plus a few database reads;
 *  - flows publish hours after the close, so scores and sentiment are computed
 *    provisionally as soon as prices are complete and recomputed when flows
 *    land; alerts and the brief wait for the final numbers, or for
 *    PIPELINE_FLOW_DEADLINE, after which the session is finalized without flows;
 *  - one dataset failing never stops the others, and is retried next poll;
 *  - overlapping invocations are refused by the shared "pipeline" lease and
 *    logged as `skipped`.
 *
 * Never throws: an unexpected error finishes the JobRun as `failed`.
 */
export async function runDailyPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const job = opts.job ?? "daily";
  const run = await startJobRun(job, opts.trigger);
  const target = { session: null as string | null };
  try {
    const locked = await withPipelineLock(() => runSessionPipeline(run, opts, target), opts.lock);
    if (locked.acquired) return locked.value;
    return await skip(run, alreadyRunningReason(locked), null);
  } catch (err) {
    return await abort(run, err, target.session);
  }
}

async function runSessionPipeline(run: JobRunHandle, opts: PipelineOptions, target: { session: string | null }): Promise<PipelineResult> {
  const now = new Date();
  const resolved = await resolveTargetSession();
  if (!resolved.session) {
    const reason = resolved.note ?? "no session stored yet — seed or backfill first";
    const status = await run.finish("failed", { reason });
    return { status, session: null, skippedReason: null, jobRunId: run.id, wroteData: false, summary: { reason } };
  }
  const day = utcDateKey(resolved.session);
  target.session = day;
  run.setSession(resolved.session);

  const options = pipelinePlanOptions();
  const state: PlanState = {
    session: day,
    previous: await loadDatasetStates(resolved.session),
    thisRun: {},
    scope: opts.job === "refresh" ? "data" : "all",
    force: !!opts.force,
  };

  const plan = planRun(state, now, options);
  if (!plan.next) return skip(run, `nothing to do: ${describe(plan)}`, day);

  const ctx: SessionContext = { session: resolved.session, stocks: await loadTrackedStocks() };
  const execution = await executePlan(run, state, now, options, sessionSteps(ctx, formatDeadline(options.flowDeadlineMin)));

  // A core dataset this run could not reach still gets a row, so the health
  // page can tell "waiting on today's prices" from "the job never got here".
  for (const d of planRun(execution.state, now, options).decisions) {
    if (d.action === "blocked" && HEALTH_CORE.includes(d.dataset)) {
      await run.record(d.dataset, { status: "skipped", note: `blocked: ${d.reason}` });
    }
  }

  const after = planRun(mergeRun(execution.state, now), now, options);

  const status = await run.finish(undefined, { reason: [resolved.note, describe(after)].filter(Boolean).join("; ") });
  return {
    status,
    session: day,
    skippedReason: null,
    jobRunId: run.id,
    wroteData: wroteData(run.datasets),
    summary: {
      mode: dataMode,
      session: day,
      sessionSource: resolved.source,
      complete: after.complete,
      settled: after.settled,
      datasets: datasetSummary(run.datasets),
      pending: after.decisions
        .filter((d) => d.action !== "done" && d.action !== "out-of-scope")
        .map((d) => ({ dataset: d.dataset, action: d.action, reason: d.reason })),
    },
  };
}

/** Whether a daily run would do anything right now. Read-only: no lock, no job log. */
export async function pipelineHasWork(now: Date = new Date()): Promise<boolean> {
  const resolved = await resolveTargetSession();
  if (!resolved.session) return false;
  const state: PlanState = {
    session: utcDateKey(resolved.session),
    previous: await loadDatasetStates(resolved.session),
    thisRun: {},
    scope: "all",
    force: false,
  };
  return planRun(state, now, pipelinePlanOptions()).next !== null;
}

function sessionSteps(ctx: SessionContext, deadline: string): StepTable {
  return {
    "market-status": () => refreshMarketStatus(ctx),
    prices: () => refreshPrices(ctx),
    fundamentals: () => refreshFundamentals(ctx),
    catalysts: () => refreshCatalysts(ctx),
    flows: (d) => refreshFlows(ctx, !!d.lastCall, deadline),
    indicators: () => refreshIndicators(),
    technicals: () => refreshTechnicals(ctx),
    scores: (d) => refreshScores(ctx, !!d.provisional),
    sentiment: (d) => refreshSentiment(ctx, !!d.provisional),
    alerts: () => alertsStep(ctx.session),
    brief: () => briefStep(ctx.session),
  };
}

async function alertsStep(session: Date): Promise<StepResult> {
  const result = await evaluateAlerts(session);
  return { value: result, outcome: { received: result.candidates, persisted: result.created } };
}

async function briefStep(session: Date): Promise<StepResult> {
  const brief = await runDailyBriefJob(session);
  return {
    value: { date: utcDateKey(brief.date), generatedBy: brief.generatedBy },
    outcome: { persisted: 1, expected: 1, provider: brief.generatedBy },
  };
}

// ---------------------------------------------------------------------------
// Session resolution and state
// ---------------------------------------------------------------------------

interface TargetSession {
  session: Date | null;
  source: "published" | "stored";
  /** Why the run fell back to the stored session, if it did. */
  note: string | null;
}

/**
 * Which session to work on: the newest one the exchange has PUBLISHED (one
 * request), not the wall-clock day — the after-hours reports land between
 * 14:30 and the evening, and never on weekends or holidays.
 *
 * Mock mode has no live feed to ask, so it works on the newest stored session,
 * which is what the seed produced. In live mode an unreachable probe falls
 * back to the newest stored session: finishing what is pending there needs no
 * answer from the probe, and a session nobody published is never invented.
 */
async function resolveTargetSession(): Promise<TargetSession> {
  if (dataMode !== "live") return { session: await latestStoredSession(), source: "stored", note: null };
  let problem: string;
  try {
    const published = await latestSessionDate();
    if (published) return { session: utcDay(published), source: "published", note: null };
    problem = "the published-session probe returned nothing";
  } catch (err) {
    problem = `the published-session probe failed (${errorText(err)})`;
  }
  return { session: await latestStoredSession(), source: "stored", note: `${problem}; worked on the newest stored session` };
}

const TRACKED: readonly string[] = [...REQUIRED_DATASETS, ...BEST_EFFORT_DATASETS];
const REQUIRED: readonly string[] = REQUIRED_DATASETS;

/** The datasets the health page (/api/health) treats as core. */
const HEALTH_CORE: readonly PipelineDataset[] = ["market-status", "prices", "flows", "scores", "sentiment"];

/** Latest recorded outcome per dataset for the session, from every job that logged one. */
async function loadDatasetStates(session: Date): Promise<PlanState["previous"]> {
  const rows = await db.datasetRun.findMany({
    where: { session, dataset: { in: [...TRACKED] } },
    orderBy: { startedAt: "desc" },
    select: { dataset: true, status: true, startedAt: true },
  });
  const previous: PlanState["previous"] = {};
  for (const row of rows) {
    // A `skipped` row of a required dataset is the "blocked: …" marker written
    // above for the health page. It says nothing about the data — and read as
    // an attempt it would count as the flows' last call after the deadline.
    if (row.status === "skipped" && REQUIRED.includes(row.dataset)) continue;
    const dataset = row.dataset as PipelineDataset;
    previous[dataset] ??= { status: row.status as DatasetStatus, at: row.startedAt };
  }
  return previous;
}

/** One line for JobRun.reason: what the session still lacks, if anything. */
function describe(plan: Plan): string {
  if (plan.complete) return `session ${plan.session} complete`;
  const givenUp = plan.decisions.filter((d) => d.action === "given-up").map((d) => `${d.dataset} (${d.reason})`);
  if (plan.settled) return `session ${plan.session} finalized without ${givenUp.join(", ")}`;
  const pending = plan.decisions
    .filter((d) => REQUIRED.includes(d.dataset) && (d.action === "run" || d.action === "hold" || d.action === "blocked"))
    .map((d) => `${d.dataset}: ${d.reason}`);
  return `session ${plan.session} pending — ${pending.join("; ")}` + (givenUp.length ? `; given up: ${givenUp.join(", ")}` : "");
}

// ---------------------------------------------------------------------------
// Standalone alerts / brief jobs
// ---------------------------------------------------------------------------

/** `/api/jobs/alerts`, `npm run jobs:alerts`: evaluate the rules for the newest scored session. */
export function runAlertsJob(opts: { trigger: JobTrigger; lock?: PipelineLockOptions }): Promise<PipelineResult> {
  return runSingleDataset("alerts", DATASETS.alerts, opts, alertsStep);
}

/** `/api/jobs/brief`, `npm run jobs:brief`: (re)generate the brief for the newest scored session. */
export function runBriefJob(opts: { trigger: JobTrigger; lock?: PipelineLockOptions }): Promise<PipelineResult> {
  return runSingleDataset("brief", DATASETS.brief, opts, briefStep);
}

/**
 * One dataset outside the pipeline, still logged and still under the pipeline
 * lease — alerts and the brief write the same rows the pipeline does. The
 * DatasetRun it records counts toward the session's completeness like any other.
 */
async function runSingleDataset(
  job: JobName,
  dataset: DatasetKey,
  opts: { trigger: JobTrigger; lock?: PipelineLockOptions },
  step: (session: Date) => Promise<StepResult>,
): Promise<PipelineResult> {
  const run = await startJobRun(job, opts.trigger);
  const target = { session: null as string | null };
  try {
    const locked = await withPipelineLock(async (): Promise<PipelineResult> => {
      const session = await latestScoredSession();
      if (!session) {
        const reason = "no scored session yet";
        const status = await run.finish("failed", { reason });
        return { status, session: null, skippedReason: null, jobRunId: run.id, wroteData: false, summary: { reason } };
      }
      target.session = utcDateKey(session);
      run.setSession(session);
      const result = await run.dataset(dataset, () => step(session));
      const status = await run.finish();
      return {
        status,
        session: target.session,
        skippedReason: null,
        jobRunId: run.id,
        wroteData: wroteData(run.datasets),
        summary: { result: result.value ?? null, error: result.error === undefined ? null : errorText(result.error) },
      };
    }, opts.lock);
    if (locked.acquired) return locked.value;
    return await skip(run, alreadyRunningReason(locked), null);
  } catch (err) {
    return await abort(run, err, target.session);
  }
}

// ---------------------------------------------------------------------------

async function skip(run: JobRunHandle, reason: string, session: string | null): Promise<PipelineResult> {
  await run.finish("skipped", { reason });
  return { status: "skipped", session, skippedReason: reason, jobRunId: run.id, wroteData: false, summary: null };
}

async function abort(run: JobRunHandle, err: unknown, session: string | null): Promise<PipelineResult> {
  console.error(`[${run.job}] aborted:`, errorText(err));
  const status = await run.finish("failed", { reason: "aborted by an unexpected error", error: err });
  return {
    status,
    session,
    skippedReason: null,
    jobRunId: run.id,
    // A step may have written before the failure; the caller expires the cache either way.
    wroteData: wroteData(run.datasets),
    summary: { error: errorText(err), datasets: datasetSummary(run.datasets) },
  };
}

function wroteData(records: readonly DatasetRecord[]): boolean {
  return records.some((r) => r.persisted > 0);
}

function datasetSummary(records: readonly DatasetRecord[]) {
  return records.map((r) => ({
    dataset: r.dataset,
    status: r.status,
    received: r.received,
    persisted: r.persisted,
    expected: r.expected,
    provider: r.provider,
    error: r.error,
    durationMs: r.durationMs,
  }));
}
