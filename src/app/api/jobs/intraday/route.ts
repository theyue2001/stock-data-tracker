import { runIntradayRefreshJob } from "@/lib/jobs/refresh-intraday";
import { authorizeJob, ok } from "@/lib/api";
import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * One TAIEX tick from the MIS feed. Point a scheduler at this every minute
 * while the market is open (08:30–13:30 Asia/Taipei, Mon–Fri) — see
 * scripts/cron.ts and vercel.json for the actual schedule. Kept separate from
 * /api/jobs/daily and /api/jobs/refresh so a minute-cadence caller never pays
 * for alerts, the daily brief, or a scores recompute.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  const result = await runIntradayRefreshJob();

  // Scoped to the `intraday` tag, not radarData — see CACHE_TAGS.intraday.
  revalidateTag(CACHE_TAGS.intraday, "max");

  return ok(result);
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
