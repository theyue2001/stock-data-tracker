import { runRefreshJob } from "@/lib/jobs/refresh-data";
import { runAlertEngine } from "@/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "@/lib/jobs/generate-daily-brief";
import { authorizeJob, ok } from "@/lib/api";
import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const maxDuration = 300;

/**
 * The full daily pipeline. Point a platform scheduler (Vercel Cron, GitHub
 * Actions, systemd timer) at this route for 20:00 Asia/Taipei, or run
 * `npm run cron` for a long-lived local scheduler.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

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
