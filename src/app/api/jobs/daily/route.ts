import { hasTodaysSession, runRefreshJob } from "@/lib/jobs/refresh-data";
import { runAlertEngine } from "@/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "@/lib/jobs/generate-daily-brief";
import { authorizeJob, ok } from "@/lib/api";
import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const maxDuration = 300;

/**
 * The full daily pipeline. Point a platform scheduler at this route every 5
 * minutes across the afternoon/evening (vercel.json polls 13:31–23:59
 * Asia/Taipei) — see hasTodaysSession for why polling this often is safe: it
 * is a no-op past the first successful run each day. `npm run cron` runs the
 * same pipeline from a long-lived local scheduler instead.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  // Each invocation here is a fresh process with no memory of an earlier
  // success today (unlike scripts/cron.ts's long-running one), so the skip
  // has to be re-derived from stored state on every call.
  if (await hasTodaysSession()) {
    return ok({ skipped: true, reason: "today's session is already stored" });
  }

  const refresh = await runRefreshJob();
  const alertsCreated = await runAlertEngine();
  const brief = await runDailyBriefJob();

  // Expire the cached read layer once, after the whole pipeline has written,
  // so no screen can show a half-updated session.
  revalidateTag(CACHE_TAGS.radarData, "max");

  return ok({
    refresh,
    alertsCreated,
    brief: { date: brief.date, generatedBy: brief.generatedBy },
  });
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
