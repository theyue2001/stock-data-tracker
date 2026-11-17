import { latestPublishedSessionStored, runRefreshJob } from "./refresh-data";
import { runAlertEngine } from "./generate-alerts";
import { runDailyBriefJob } from "./generate-daily-brief";
import type { JobTrigger, RunStatus } from "./run-log";

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

/**
 * The after-hours pipeline (prices, flows, scores, sentiment, alerts, brief)
 * for the newest published session. The single entry point shared by
 * /api/jobs/daily, scripts/run-daily.ts and the long-running scheduler in
 * scripts/cron.ts, so all three get the same gating, locking and logging.
 */
export async function runDailyPipeline(opts: { trigger: JobTrigger }): Promise<PipelineResult> {
  void opts.trigger;
  if (await latestPublishedSessionStored()) {
    return {
      status: "skipped",
      session: null,
      skippedReason: "the latest published session is already stored",
      jobRunId: null,
      wroteData: false,
      summary: null,
    };
  }
  const refresh = await runRefreshJob();
  const alertsCreated = await runAlertEngine();
  const brief = await runDailyBriefJob();
  return {
    status: "success",
    session: null,
    skippedReason: null,
    jobRunId: null,
    wroteData: true,
    summary: { refresh, alertsCreated, brief: { date: brief.date, generatedBy: brief.generatedBy } },
  };
}
