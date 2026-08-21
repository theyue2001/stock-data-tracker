import { runRefreshJob } from "@/lib/jobs/refresh-data";
import { runAlertEngine } from "@/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "@/lib/jobs/generate-daily-brief";
import { authorizeJob, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The full daily pipeline. Point a platform scheduler (Vercel Cron, GitHub
 * Actions, systemd timer) at this route for 20:00 Asia/Taipei, or run
 * `npm run cron` for a long-lived local scheduler.
 */
export async function POST(request: Request) {
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  const refresh = await runRefreshJob();
  const alertsCreated = await runAlertEngine();
  const brief = await runDailyBriefJob();

  return ok({
    refresh,
    alertsCreated,
    brief: { date: brief.date, generatedBy: brief.generatedBy },
  });
}
