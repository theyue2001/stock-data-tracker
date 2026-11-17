import { db } from "@/lib/db";
import { ensureDataSource, writeIntradayIndex } from "@/lib/jobs/persist";
import { withJobLock } from "@/lib/jobs/job-lock";
import { DATASETS, startJobRun, type JobTrigger, type RunStatus } from "@/lib/jobs/run-log";
import { isTradingDay, marketPhase, sessionKey, sessionString, taipeiNow } from "@/lib/market-session";
import { intradayIndexProviders, intradayPollFloorSeconds } from "@/lib/providers/registry";

export interface IntradayRefreshSummary {
  status: RunStatus;
  /** IntradayIndex rows written. Callers expire the `intraday` cache tag only when this is > 0. */
  ticks: number;
  /** Exchange time ("HH:mm:ss") of the newest tick the feed reported, written or not. */
  tickAt: string | null;
  /** Why the run fetched or wrote nothing, when that is the outcome. */
  skippedReason: string | null;
  /** JobRun.id of this invocation, when it was logged. */
  jobRunId: string | null;
}

/** Lease for one tick: one fetch (10 s timeout, one retry) and one upsert. */
const LOCK_TTL_MS = 2 * 60_000;

/**
 * How much sooner than a source's `minIntervalSeconds` a fetch may follow the
 * previous one. Grid-aligned scheduler ticks land a few hundred ms either side
 * of the exact interval, and one of them must not be refused for that.
 */
const FLOOR_SLACK_MS = 5_000;

/**
 * Refuses a fetch that would follow the previous one sooner than the slowest
 * registered source allows. The collector already clamps its own interval;
 * this holds every OTHER caller of the job — an external cron pointed at
 * /api/jobs/intraday every 10 s, or a CLI run on top of the collector — to
 * the same floor. Reads the job log (indexed on dataset, startedAt), so it
 * needs no state of its own; best-effort like the log itself.
 */
async function pollTooSoon(): Promise<string | null> {
  const floorMs = intradayPollFloorSeconds() * 1000;
  if (floorMs <= 0) return null;
  try {
    const last = await db.datasetRun.findFirst({
      where: { dataset: DATASETS.intradayIndex },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (!last) return null;
    const ageMs = Date.now() - last.startedAt.getTime();
    if (ageMs >= floorMs - FLOOR_SLACK_MS) return null;
    return `the previous intraday fetch was ${Math.max(0, Math.round(ageMs / 1000))} s ago; the source allows one per ${floorMs / 1000} s`;
  } catch (err) {
    console.error("[intraday] poll-floor check failed, fetching anyway:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The intraday sibling of the daily pipeline. Deliberately its own job: it
 * polls one lightweight endpoint and writes one row, so it can run on the
 * intraday cadence without paying for alerts, the daily brief, or a scores
 * recompute on every tick.
 *
 * Every invocation is one JobRun ("intraday") with one DatasetRun
 * ("intraday-index") per fetch, whose `sourceAsOf` is the exchange's tick
 * time. It fetches only on a trading day from the 09:00 open onwards — the
 * session, and after 13:30 the closing print — and skips, without a request,
 * on weekends, holidays and before the open, where the feed could only repeat
 * an older session's tick. A feed that has not traded today yet is recorded
 * as `waiting`, never written. Runs under the "intraday" lease, so the
 * collector, the route and a CLI run never overlap.
 */
export async function runIntradayRefreshJob(opts: { trigger: JobTrigger; now?: Date }): Promise<IntradayRefreshSummary> {
  const now = opts.now ?? new Date();
  const today = taipeiNow(now).date;
  const phase = marketPhase(now);
  const run = await startJobRun("intraday", opts.trigger, { session: isTradingDay(today) ? sessionKey(today) : null });

  const summary = (status: RunStatus, rest: Partial<IntradayRefreshSummary> = {}): IntradayRefreshSummary => ({
    status,
    ticks: 0,
    tickAt: null,
    skippedReason: null,
    jobRunId: run.id,
    ...rest,
  });
  const skip = async (reason: string) => summary(await run.finish("skipped", { reason }), { skippedReason: reason });

  if (intradayIndexProviders.length === 0) return skip("no intraday provider is registered (DATA_MODE=mock)");
  if (phase === "closed-day") return skip(`${today} is not a trading day (weekend or TWSE holiday)`);
  if (phase === "pre-open") return skip("before the 09:00 open; the feed has no tick for today yet");

  try {
    let ticks = 0;
    let tickAt: string | null = null;

    const locked = await withJobLock("intraday", LOCK_TTL_MS, async () => {
      const tooSoon = await pollTooSoon();
      if (tooSoon) return tooSoon;

      for (const provider of intradayIndexProviders) {
        const step = await run.dataset(DATASETS.intradayIndex, async () => {
          const results = await provider.fetchLatest();
          const base = { provider: provider.source.key, received: results.length };
          if (results.length === 0) {
            return { value: 0, outcome: { ...base, status: "waiting" as const, note: "the feed has no trade for this session yet" } };
          }

          const newest = results.reduce((a, b) => ((b.tickEpochMs ?? 0) > (a.tickEpochMs ?? 0) ? b : a));
          tickAt = newest.tickAt;
          const sourceAsOf = newest.tickEpochMs ? new Date(newest.tickEpochMs) : null;
          const current = results.filter((r) => sessionString(r.date) === today);
          if (current.length === 0) {
            const reported = sessionString(newest.date);
            return {
              value: 0,
              outcome: { ...base, status: "waiting" as const, sourceAsOf, note: `the feed still reports session ${reported}; no tick for ${today} yet` },
            };
          }

          const sourceId = await ensureDataSource(provider.source);
          const written = await writeIntradayIndex(current, sourceId, provider.source.isMock);
          return { value: written, outcome: { ...base, persisted: written, sourceAsOf } };
        });
        ticks += step.value ?? 0;
      }
      return null;
    });

    if (!locked.acquired) return skip(`another intraday run holds the lock (${locked.heldBy ?? "holder unknown"})`);
    if (locked.value) return skip(locked.value);

    // A fetch that found no trade yet did nothing wrong and wrote nothing:
    // the run is "skipped" with the step's note, not "partial".
    const waitingOnly = run.datasets.length > 0 && run.datasets.every((d) => d.status === "waiting");
    const status = waitingOnly
      ? await run.finish("skipped", { reason: run.datasets[0].error })
      : await run.finish();
    return summary(status, { ticks, tickAt, skippedReason: waitingOnly ? run.datasets[0].error : null });
  } catch (err) {
    // Only the lease itself can throw here (dataset steps record their own
    // failures); close the run as failed before the caller sees the error.
    await run.finish("failed", { error: err });
    throw err;
  }
}
