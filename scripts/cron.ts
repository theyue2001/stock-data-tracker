/**
 * Long-running scheduler for local/self-hosted deployments.
 *
 * Two independent rhythms, not one:
 *
 *  - INTRADAY (08:30–13:30 Asia/Taipei, Mon–Fri, every minute): polls the
 *    TWSE MIS real-time feed for the TAIEX level only. Cheap — one request —
 *    and the only thing in this file with anything new to say during the
 *    session, since every other provider reads an after-hours report.
 *  - PIPELINE (13:31–23:59 Asia/Taipei, Mon–Fri, every 5 minutes): checks
 *    whether today's after-hours session (prices, flows, fundamentals) has
 *    been fetched yet, and runs the full refresh -> alerts -> brief pipeline
 *    the first time it has. A calendar-day guard makes every check after the
 *    first a no-op, so this polls for "has TWSE published yet" without
 *    re-fetching the same settled session every 5 minutes for the rest of the
 *    day — the interactive TWSE host IP-blocks a client for sustained
 *    iteration over one report path (see providers/live/http.ts), and hundreds
 *    of a-priori-pointless repeats would eventually trip that.
 *  - Nothing runs 00:00–08:29: no provider here has anything new to report
 *    before the market opens.
 *
 * This file is one of two ways to get that cadence; the other is an external
 * cron service calling /api/jobs/intraday and /api/jobs/daily on the same
 * schedule (both protected by CRON_SECRET). Vercel Cron is NOT a third option
 * for the intraday leg — Hobby fires at most once a day — so `vercel.json`
 * deliberately keeps only a daily safety net. See README, "Driving the jobs
 * from outside".
 */
import cron from "node-cron";
import { hasTodaysSession, runRefreshJob } from "../src/lib/jobs/refresh-data";
import { runAlertEngine } from "../src/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "../src/lib/jobs/generate-daily-brief";
import { runIntradayRefreshJob } from "../src/lib/jobs/refresh-intraday";
import { revalidateDeployedCache } from "./_revalidate";

const TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Taipei";

// Three expressions because cron has no "8:30–13:30" range across an hour
// boundary: the middle hours run every minute, the two edge hours only for
// the minutes actually inside the session.
const INTRADAY_SCHEDULES = process.env.CRON_INTRADAY_SCHEDULE?.split(",") ?? [
  "30-59 8 * * 1-5",
  "* 9-12 * * 1-5",
  "0-30 13 * * 1-5",
];
const PIPELINE_CHECK_SCHEDULE = process.env.CRON_PIPELINE_SCHEDULE || "*/5 13-23 * * 1-5";

async function runIntradayTick() {
  try {
    const result = await runIntradayRefreshJob();
    if (result.ticks) await revalidateDeployedCache("cron-intraday", "intraday");
  } catch (err) {
    console.error("[cron] intraday tick failed:", err);
  }
}

async function runPipeline() {
  const startedAt = new Date().toISOString();
  console.log(`[cron] pipeline start ${startedAt}`);
  try {
    console.log("[cron] refresh:", await runRefreshJob());
    console.log(`[cron] alerts: ${await runAlertEngine()} new`);
    const brief = await runDailyBriefJob();
    console.log(`[cron] brief generated via ${brief.generatedBy}`);
    // Inside the try: a failed pipeline must not tell the dashboard to
    // re-render from data that was never finished being written.
    await revalidateDeployedCache("cron");
  } catch (err) {
    console.error("[cron] pipeline failed:", err);
  }
}

/** hasTodaysSession is the same DB-state guard the serverless route uses —
 *  see its doc comment for why it's the source of truth rather than an
 *  in-memory flag: it stays correct across a restart of this process too. */
async function checkAndRunPipeline() {
  if (await hasTodaysSession()) return;
  await runPipeline();
}

for (const schedule of INTRADAY_SCHEDULES) {
  cron.schedule(schedule, runIntradayTick, { timezone: TIMEZONE });
}
cron.schedule(PIPELINE_CHECK_SCHEDULE, checkAndRunPipeline, { timezone: TIMEZONE });

console.log(
  `[cron] intraday "${INTRADAY_SCHEDULES.join(" | ")}", pipeline check "${PIPELINE_CHECK_SCHEDULE}" (${TIMEZONE}). Press Ctrl+C to stop.`,
);
