import { db } from "@/lib/db";
import { NotPublishedError, httpStatusOf } from "@/lib/providers/errors";

/**
 * Structured job log: one JobRun per invocation, one DatasetRun per dataset
 * step (see the models in prisma/schema.prisma).
 *
 * Logging must never take the job down with it. Every write here is
 * best-effort: if the database rejects a log row the job carries on, the
 * failure goes to stderr, and the handle keeps tracking outcomes in memory so
 * `finish()` still returns the right overall status.
 */

export const DATASETS = {
  /** TAIEX close, turnover, breadth, market-wide institutional net (MarketStatus) */
  marketStatus: "market-status",
  /** per-stock daily OHLCV, listed + OTC (MarketData) */
  prices: "prices",
  /** monthly revenue / YTD EPS (StockFundamental) */
  fundamentals: "fundamentals",
  /** MOPS material announcements (Catalyst) */
  catalysts: "catalysts",
  /** per-stock and industry institutional flows + margin (InstitutionalFlow) */
  flows: "flows",
  /** external leading indicators (IndicatorValue) */
  indicators: "indicators",
  /** derived technical fields and stock status (MarketData, Stock) */
  technicals: "technicals",
  /** Industry Heat Score (IndustryScore) */
  scores: "scores",
  /** Industry Sentiment (IndustrySentimentSnapshot) */
  sentiment: "sentiment",
  alerts: "alerts",
  brief: "brief",
  /** intraday TAIEX tick (IntradayIndex) */
  intradayIndex: "intraday-index",
  /** live-source shape probes (verify job) */
  verify: "verify",
} as const;
export type DatasetKey = (typeof DATASETS)[keyof typeof DATASETS];

export type JobName = "daily" | "refresh" | "intraday" | "alerts" | "brief" | "verify" | "backfill" | "import-indicators";
export type JobTrigger = "vercel-cron" | "external-cron" | "github-actions" | "route" | "cli" | "scheduler";
export type RunStatus = "running" | "success" | "partial" | "failed" | "skipped";
export type DatasetStatus = "success" | "partial" | "failed" | "skipped" | "waiting";

/** What a dataset step reports about itself. */
export interface DatasetOutcome {
  /** Defaults to "success". Use "partial" when fewer rows than `expected` landed. */
  status?: DatasetStatus;
  received?: number;
  persisted?: number;
  expected?: number | null;
  provider?: string | null;
  /** Session the data describes; defaults to the run's session. */
  session?: Date | null;
  /** The data's own as-of time (session close, tick time). */
  sourceAsOf?: Date | null;
  /** Free-text note stored in `error` for non-success statuses (e.g. why partial). */
  note?: string | null;
}

export interface DatasetRecord {
  dataset: DatasetKey;
  status: DatasetStatus;
  received: number;
  persisted: number;
  expected: number | null;
  provider: string | null;
  session: Date | null;
  sourceAsOf: Date | null;
  httpStatus: number | null;
  error: string | null;
  durationMs: number;
}

export interface DatasetStepResult<T> {
  status: DatasetStatus;
  /** true for success / partial / skipped — the step produced something usable or had nothing to do. */
  ok: boolean;
  value?: T;
  error?: unknown;
}

export interface JobRunHandle {
  /** JobRun.id, or null when the run row could not be written. */
  readonly id: string | null;
  readonly job: JobName;
  setSession(session: Date | null): void;
  /**
   * Run one dataset step, time it, and record the outcome. Never throws:
   * `NotPublishedError` is recorded as `waiting`, anything else as `failed`
   * with its message and HTTP status, and the error is returned to the caller.
   */
  dataset<T>(dataset: DatasetKey, fn: () => Promise<{ value: T; outcome?: DatasetOutcome }>): Promise<DatasetStepResult<T>>;
  /** Record a step the caller timed itself, or one it decided not to run (`skipped` / `waiting`). */
  record(dataset: DatasetKey, outcome: DatasetOutcome & { status: DatasetStatus; error?: unknown; durationMs?: number }): Promise<void>;
  /** Everything recorded so far, in order. */
  readonly datasets: readonly DatasetRecord[];
  /**
   * Close the run. Without an explicit status it is derived from the
   * datasets: all success/skipped → success; any failed → failed if nothing
   * succeeded, else partial; otherwise any waiting/partial → partial.
   */
  finish(status?: RunStatus, opts?: { reason?: string | null; error?: unknown }): Promise<RunStatus>;
}

const MAX_TEXT = 2000;

/** One-line, length-capped error text for the log. */
export function errorText(err: unknown): string {
  if (err == null) return "";
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/**
 * Who fired a job route. Vercel Cron identifies itself by User-Agent; an
 * external scheduler or GitHub Actions should send `x-job-trigger`.
 */
export function triggerFrom(request: Request): JobTrigger {
  const declared = request.headers.get("x-job-trigger");
  if (declared === "external-cron" || declared === "github-actions" || declared === "scheduler") return declared;
  if ((request.headers.get("user-agent") ?? "").startsWith("vercel-cron")) return "vercel-cron";
  return "route";
}

/**
 * Marks an error with the DataSource key of the provider that raised it, so a
 * failed or waiting DatasetRun still names its source — the health page groups
 * by (dataset, provider), and an unattributed failure would sit in a group of
 * its own. Returns the same error, for `throw attributeTo(err, key)`.
 */
export function attributeTo<E>(err: E, provider: string): E {
  if (err && typeof err === "object" && typeof (err as { provider?: unknown }).provider !== "string") {
    (err as { provider?: string }).provider = provider;
  }
  return err;
}

/** The provider an error was attributed to, else the source a NotPublishedError names. */
function providerOf(err: unknown): string | null {
  const tagged = (err as { provider?: unknown } | null)?.provider;
  if (typeof tagged === "string") return tagged;
  return err instanceof NotPublishedError ? err.source : null;
}

export function deriveRunStatus(statuses: readonly DatasetStatus[]): RunStatus {
  if (statuses.length === 0) return "success";
  const failed = statuses.filter((s) => s === "failed").length;
  if (failed > 0) return failed === statuses.length ? "failed" : "partial";
  if (statuses.some((s) => s === "waiting" || s === "partial")) return "partial";
  return "success";
}

async function safe<T>(what: string, op: () => Promise<T>): Promise<T | null> {
  try {
    return await op();
  } catch (err) {
    console.error(`[run-log] ${what} failed:`, errorText(err));
    return null;
  }
}

export async function startJobRun(job: JobName, trigger: JobTrigger, opts: { session?: Date | null } = {}): Promise<JobRunHandle> {
  const startedAt = new Date();
  let session = opts.session ?? null;
  const row = await safe("JobRun.create", () => db.jobRun.create({ data: { job, trigger, session, status: "running", startedAt }, select: { id: true } }));
  const id = row?.id ?? null;
  const datasets: DatasetRecord[] = [];
  let finished: RunStatus | null = null;

  async function write(rec: DatasetRecord, startedAtStep: Date) {
    datasets.push(rec);
    if (!id) return;
    await safe(`DatasetRun.create(${rec.dataset})`, () =>
      db.datasetRun.create({
        data: {
          jobRunId: id,
          dataset: rec.dataset,
          provider: rec.provider,
          session: rec.session,
          status: rec.status,
          received: rec.received,
          persisted: rec.persisted,
          expected: rec.expected,
          httpStatus: rec.httpStatus,
          error: rec.error,
          sourceAsOf: rec.sourceAsOf,
          startedAt: startedAtStep,
          finishedAt: new Date(startedAtStep.getTime() + rec.durationMs),
          durationMs: rec.durationMs,
        },
      }),
    );
  }

  function toRecord(dataset: DatasetKey, o: DatasetOutcome & { status: DatasetStatus }, durationMs: number, err?: unknown): DatasetRecord {
    const note = o.note ?? null;
    return {
      dataset,
      status: o.status,
      received: o.received ?? 0,
      persisted: o.persisted ?? 0,
      expected: o.expected ?? null,
      provider: o.provider ?? null,
      session: o.session === undefined ? session : o.session,
      sourceAsOf: o.sourceAsOf ?? null,
      httpStatus: err === undefined ? null : httpStatusOf(err),
      error: err !== undefined ? errorText(err) : o.status === "success" ? null : note,
      durationMs,
    };
  }

  const handle: JobRunHandle = {
    id,
    job,
    get datasets() {
      return datasets;
    },
    setSession(s) {
      session = s;
      if (id) void safe("JobRun.update(session)", () => db.jobRun.update({ where: { id }, data: { session: s } }));
    },
    async dataset(dataset, fn) {
      const t0 = new Date();
      try {
        const { value, outcome = {} } = await fn();
        const status = outcome.status ?? "success";
        await write(toRecord(dataset, { ...outcome, status }, Date.now() - t0.getTime()), t0);
        return { status, ok: status !== "failed" && status !== "waiting", value };
      } catch (err) {
        const status: DatasetStatus = err instanceof NotPublishedError ? "waiting" : "failed";
        if (status === "failed") console.error(`[${job}] ${dataset} failed:`, errorText(err));
        await write(toRecord(dataset, { status, provider: providerOf(err) }, Date.now() - t0.getTime(), err), t0);
        return { status, ok: false, error: err };
      }
    },
    async record(dataset, outcome) {
      const t0 = new Date();
      const { error, durationMs = 0, ...rest } = outcome;
      await write(toRecord(dataset, rest, durationMs, error === undefined ? undefined : error), new Date(t0.getTime() - durationMs));
    },
    async finish(status, opts = {}) {
      if (finished) return finished;
      const final = status ?? deriveRunStatus(datasets.map((d) => d.status));
      finished = final;
      const finishedAt = new Date();
      if (id) {
        await safe("JobRun.update(finish)", () =>
          db.jobRun.update({
            where: { id },
            data: {
              status: final,
              session,
              reason: opts.reason ?? null,
              error: opts.error === undefined ? null : errorText(opts.error),
              finishedAt,
              durationMs: finishedAt.getTime() - startedAt.getTime(),
            },
          }),
        );
      }
      return final;
    },
  };
  return handle;
}
