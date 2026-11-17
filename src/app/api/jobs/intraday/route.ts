import { runIntradayRefreshJob } from "@/lib/jobs/refresh-intraday";
import { errorText, triggerFrom } from "@/lib/jobs/run-log";
import { authorizeJob, ok } from "@/lib/api";
import { NextResponse, connection } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * One TAIEX tick from the MIS feed, for deployments without the long-running
 * collector (`npm run cron`). Point an external scheduler at it on a trading
 * day from 09:00 to 13:35 Asia/Taipei, no more often than once a minute —
 * the job refuses calls closer together than the source allows (see
 * TwseMisIndexProvider.minIntervalSeconds) and skips weekends, holidays and
 * the pre-open itself, so over-calling costs a logged skip, not a request.
 * Kept separate from /api/jobs/daily so an intraday caller never pays for
 * alerts, the daily brief, or a scores recompute.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runIntradayRefreshJob({ trigger: triggerFrom(request) });

    // Scoped to the `intraday` tag, not radarData — see CACHE_TAGS.intraday.
    // `{ expire: 0 }` rather than "max": the tag's whole point is the newest
    // tick, and stale-while-revalidate would show the previous one to the
    // next visitor. Only when a row was written; a skip changes nothing.
    if (result.ticks > 0) revalidateTag(CACHE_TAGS.intraday, { expire: 0 });

    return ok(result);
  } catch (err) {
    // The job has already closed its JobRun as failed; answer in JSON so a
    // scheduler sees a 500 with the reason rather than an HTML error page.
    return NextResponse.json({ error: errorText(err) }, { status: 500 });
  }
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
