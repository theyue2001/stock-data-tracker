/**
 * The shared backend collector for local/self-hosted deployments: the one
 * process that talks to the exchanges on a schedule. Browsers never call an
 * exchange; every viewer reads what this process (or the job routes) stored.
 *
 * Two independent legs:
 *
 *  - INTRADAY: a self-scheduling loop rather than a cron expression, because
 *    its cadence is in seconds and must follow the exchange calendar. It ticks
 *    every INTRADAY_INTERVAL_SECONDS (default 60) on a grid from the 09:00
 *    open while the session is open, takes one final tick at 13:35 for the
 *    closing print, then sleeps until the next trading day's open — across
 *    nights, weekends and the TWSE holiday table in src/lib/market-session.ts.
 *    The interval is clamped up to the largest `minIntervalSeconds` of the
 *    registered intraday providers (60 s for the MIS index feed, see
 *    TwseMisIndexProvider), so configuration can slow polling down but never
 *    push a source past what it allows. Rules and tests live in
 *    src/lib/intraday-cadence.ts.
 *  - PIPELINE: node-cron, every 5 minutes from 13:30 to 23:55 Asia/Taipei on
 *    trading days (PIPELINE_SCHEDULES below; holidays are skipped in the
 *    handler, since a cron day-of-week field only knows weekends). Each check
 *    calls runDailyPipeline({ trigger: "scheduler" }) — the same entry point
 *    as /api/jobs/daily — which is a no-op until TWSE has published a session
 *    that is not stored yet. `noOverlap` plus an in-process guard keep a slow
 *    run from being stacked by the next check.
 *
 * Environment:
 *  - INTRADAY_INTERVAL_SECONDS: intraday cadence in seconds (default 60,
 *    clamped up to the providers' floor).
 *  - CRON_PIPELINE_SCHEDULE: comma-separated cron expressions for the
 *    pipeline check (default: PIPELINE_SCHEDULES below).
 *  - CRON_TIMEZONE: timezone of those expressions (default Asia/Taipei). The
 *    intraday loop always runs on the Taipei exchange clock.
 *  - CRON_INTRADAY_SCHEDULE: no longer read — the intraday leg has no cron
 *    expression any more; a warning says so when it is set.
 *
 * Ctrl+C / SIGTERM stops both legs, waits briefly for a running job, and
 * disconnects from the database; a second signal exits at once.
 *
 * The alternative to this process is an external cron service calling
 * /api/jobs/intraday and /api/jobs/daily (both protected by CRON_SECRET); the
 * intraday job enforces the same source floor and calendar for those calls.
 * Vercel Cron is NOT an option for the intraday leg — Hobby fires at most once
 * a day — so `vercel.json` deliberately keeps only a daily safety net. See
 * README, "Driving the jobs from outside".
 */
import cron, { type ScheduledTask } from "node-cron";
import { db } from "../src/lib/db";
import { runDailyPipeline } from "../src/lib/jobs/pipeline";
import { runIntradayRefreshJob } from "../src/lib/jobs/refresh-intraday";
import {
  DEFAULT_INTRADAY_INTERVAL_SECONDS,
  FINAL_TICK_MIN,
  formatTaipei,
  nextIntradayTickAt,
  resolveIntradayInterval,
  taipeiInstant,
} from "../src/lib/intraday-cadence";
import { isTradingDay, marketPhase, taipeiNow } from "../src/lib/market-session";
import { intradayIndexProviders, intradayPollFloorSeconds } from "../src/lib/providers/registry";
import { revalidateDeployedCache } from "./_revalidate";

const TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Taipei";

// Two expressions because cron cannot say "from 13:30" inside an hour range:
// 13:30–13:55, then every 5 minutes of 14:00–23:55.
const PIPELINE_SCHEDULES = (process.env.CRON_PIPELINE_SCHEDULE || "30-55/5 13 * * 1-5,*/5 14-23 * * 1-5")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Longest single sleep. The loop re-derives its target after this, so a
 *  suspended machine or a clock correction can't leave it asleep past an open. */
const MAX_SLEEP_MS = 15 * 60_000;

/** How long a shutdown waits for a running tick or pipeline before exiting
 *  anyway; the job's lease lapses on its own and the next run resumes. */
const SHUTDOWN_GRACE_MS = 25_000;

const appUrlSet = Boolean(process.env.APP_URL?.trim());

let stopping = false;
/** Ends the intraday loop's current sleep early (shutdown). */
let wake: (() => void) | null = null;
let intradayLoopDone: Promise<void> = Promise.resolve();
let pipelineRunning = false;

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  const parts = [Math.floor(m / 1440) && `${Math.floor(m / 1440)}d`, Math.floor((m % 1440) / 60) && `${Math.floor((m % 1440) / 60)}h`, `${m % 60}m`];
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Intraday leg
// ---------------------------------------------------------------------------

async function intradayTick(final: boolean, last: { status: string | null }) {
  try {
    const r = await runIntradayRefreshJob({ trigger: "scheduler" });
    // One line per change of outcome (first tick of the day, a failure, the
    // recovery) and for the closing print — not 270 identical lines a day.
    if (final || r.status !== last.status) {
      const detail = [r.tickAt && `tick ${r.tickAt}`, r.ticks && `${r.ticks} row(s) written`, r.skippedReason]
        .filter(Boolean)
        .join(", ");
      console.log(`[cron] intraday ${final ? "final tick" : "tick"}: ${r.status}${detail ? ` (${detail})` : ""}`);
    }
    last.status = r.status;
    if (r.ticks > 0 && appUrlSet) await revalidateDeployedCache("cron-intraday", "intraday");
  } catch (err) {
    last.status = "error";
    console.error("[cron] intraday tick failed:", err);
  }
}

async function intradayLoop(intervalSec: number): Promise<void> {
  const last = { status: null as string | null };
  let announced = 0;

  while (!stopping) {
    const now = new Date();
    const target = nextIntradayTickAt(now, intervalSec);
    const delay = target.getTime() - now.getTime();

    // Anything longer than one interval is a gap in the schedule (the final
    // tick, overnight, a weekend or holiday): say once when polling resumes.
    if (delay > intervalSec * 1000 + 1000 && target.getTime() !== announced) {
      announced = target.getTime();
      last.status = null;
      console.log(
        `[cron] intraday: market ${marketPhase(now)}; next tick ${formatTaipei(target)} Asia/Taipei, in ${duration(delay)} — not polling until then`,
      );
    }

    await interruptibleSleep(Math.min(delay, MAX_SLEEP_MS));
    if (stopping) break;
    if (delay > MAX_SLEEP_MS) continue; // woke from a chunk of a long sleep, not at the target

    const final = target.getTime() === taipeiInstant(taipeiNow(target).date, FINAL_TICK_MIN);
    await intradayTick(final, last);
  }
}

// ---------------------------------------------------------------------------
// Pipeline leg
// ---------------------------------------------------------------------------

async function pipelineCheck() {
  // The day-of-week field only drops weekends; the exchange calendar drops holidays.
  if (!isTradingDay(taipeiNow().date)) return;
  // noOverlap is per task; this also covers the hand-over between the two
  // default expressions (a 13:55 run still going at 14:00).
  if (pipelineRunning) return;
  pipelineRunning = true;
  try {
    const r = await runDailyPipeline({ trigger: "scheduler" });
    // "skipped" is the normal 5-minute "nothing new published yet" answer.
    if (r.status !== "skipped") {
      console.log(`[cron] pipeline ${r.status}${r.session ? ` for ${r.session}` : ""}:`, r.summary ?? "");
    }
    // Inside the try: a failed pipeline must not tell the dashboard to
    // re-render from data that was never finished being written.
    if (r.wroteData) await revalidateDeployedCache("cron");
  } catch (err) {
    console.error("[cron] pipeline failed:", err);
  } finally {
    pipelineRunning = false;
  }
}

/** The next time any pipeline task fires on a trading day, for the startup line. */
function nextPipelineRun(tasks: ScheduledTask[]): Date | null {
  const runs = tasks
    .flatMap((t) => t.getNextRuns(1500))
    .filter((d) => isTradingDay(taipeiNow(d).date))
    .sort((a, b) => a.getTime() - b.getTime());
  return runs[0] ?? null;
}

// ---------------------------------------------------------------------------
// Startup and shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string) {
  if (stopping) {
    console.log(`[cron] ${signal} again — exiting without waiting`);
    process.exit(1);
  }
  stopping = true;
  console.log(`[cron] ${signal} received — stopping (waiting up to ${SHUTDOWN_GRACE_MS / 1000}s for a running job)`);
  wake?.();
  await Promise.race([
    Promise.allSettled([cron.shutdown(SHUTDOWN_GRACE_MS), intradayLoopDone]),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
  ]);
  await db.$disconnect().catch(() => {});
  console.log("[cron] stopped");
  process.exit(0);
}

function main() {
  if (process.env.CRON_INTRADAY_SCHEDULE) {
    console.warn(
      "[cron] CRON_INTRADAY_SCHEDULE is no longer read: the intraday leg follows the exchange calendar. Set INTRADAY_INTERVAL_SECONDS to change its cadence.",
    );
  }
  if (!appUrlSet) {
    console.warn("[cron] APP_URL is not set — intraday ticks will not invalidate a deployed read cache.");
  }

  for (const expr of PIPELINE_SCHEDULES) {
    if (!cron.validate(expr)) throw new Error(`[cron] invalid CRON_PIPELINE_SCHEDULE entry "${expr}"`);
  }
  const pipelineTasks = PIPELINE_SCHEDULES.map((expr, i) =>
    cron.schedule(expr, pipelineCheck, { timezone: TIMEZONE, noOverlap: true, name: `pipeline-${i}` }),
  );

  if (intradayIndexProviders.length === 0) {
    console.log("[cron] intraday: no intraday provider registered (DATA_MODE=mock) — intraday leg disabled");
  } else {
    const raw = process.env.INTRADAY_INTERVAL_SECONDS;
    const interval = resolveIntradayInterval(raw, intradayPollFloorSeconds());
    if (interval.requested === null) {
      console.warn(`[cron] INTRADAY_INTERVAL_SECONDS="${raw}" is not a positive number; using ${DEFAULT_INTRADAY_INTERVAL_SECONDS} s`);
    }
    if (interval.clamped) {
      console.warn(
        `[cron] INTRADAY_INTERVAL_SECONDS=${interval.requested} is faster than the registered intraday source allows; clamped to ${interval.seconds} s`,
      );
    }
    console.log(
      `[cron] intraday: every ${interval.seconds} s from 09:00 while the session is open, final tick 13:35, trading days only (source floor ${interval.floor} s)`,
    );
    intradayLoopDone = intradayLoop(interval.seconds).catch((err) => {
      console.error("[cron] intraday loop stopped:", err);
    });
  }

  const next = nextPipelineRun(pipelineTasks);
  console.log(
    `[cron] pipeline check "${PIPELINE_SCHEDULES.join(" | ")}" (${TIMEZONE}), trading days only; next ${next ? `${formatTaipei(next)} Asia/Taipei` : "not found in the next few days"}. Press Ctrl+C to stop.`,
  );
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
main();
