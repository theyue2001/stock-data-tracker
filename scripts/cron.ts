/**
 * Long-running scheduler for local/self-hosted deployments.
 * Runs the daily pipeline at 20:00 Taiwan time (after market close + settlement).
 *
 * On serverless platforms use the platform's own scheduler instead and point
 * it at POST /api/jobs/daily (protected by CRON_SECRET) — see README.
 */
import cron from "node-cron";
import { runRefreshJob } from "../src/lib/jobs/refresh-data";
import { runAlertEngine } from "../src/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "../src/lib/jobs/generate-daily-brief";

const SCHEDULE = process.env.CRON_SCHEDULE || "0 20 * * 1-5";
const TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Taipei";

async function runPipeline() {
  const startedAt = new Date().toISOString();
  console.log(`[cron] pipeline start ${startedAt}`);
  try {
    console.log("[cron] refresh:", await runRefreshJob());
    console.log(`[cron] alerts: ${await runAlertEngine()} new`);
    const brief = await runDailyBriefJob();
    console.log(`[cron] brief generated via ${brief.generatedBy}`);
  } catch (err) {
    console.error("[cron] pipeline failed:", err);
  }
}

cron.schedule(SCHEDULE, runPipeline, { timezone: TIMEZONE });
console.log(`[cron] scheduled "${SCHEDULE}" (${TIMEZONE}). Press Ctrl+C to stop.`);
