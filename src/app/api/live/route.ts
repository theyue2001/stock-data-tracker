import { connection } from "next/server";
import { buildLiveSnapshot, intradayIntervalSeconds } from "@/lib/live/snapshot";
import { getLiveSources } from "@/lib/live/sources";

/**
 * GET /api/live — the one endpoint every open dashboard tab polls (see
 * src/components/live/live-refresher.tsx). Public and read-only: it reads
 * what the jobs already stored and never calls an exchange API, so browser
 * traffic can never turn into upstream traffic.
 *
 * Two layers keep N viewers from costing N database round trips:
 *   - getLiveSources() is a `"use cache"` read with a 5 s revalidate, shared
 *     by every request an instance serves;
 *   - `s-maxage` lets the CDN in front of the deployment answer repeat polls
 *     without invoking the function at all. The in-memory cache alone is not
 *     enough on serverless, where instances are short-lived and not shared
 *     (node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md,
 *     "Runtime caching considerations").
 * Both windows are far inside the 即時 window (2 × the intraday poll
 * interval), and the browser recomputes the label from the tick's own time,
 * so a few seconds of caching can delay a new tick but never mislabel one.
 *
 * Phase, tick age and staleness depend on the clock, so they are computed
 * here per request — after `connection()`, which keeps the handler out of
 * prerendering — never inside the cached read.
 */
export async function GET() {
  await connection();
  try {
    const snapshot = buildLiveSnapshot(await getLiveSources(), new Date(), intradayIntervalSeconds());
    return Response.json(snapshot, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=10" },
    });
  } catch (err) {
    console.error("[api/live] snapshot failed:", err);
    return Response.json({ error: "snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
