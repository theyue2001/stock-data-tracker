/**
 * Cache tags for the `"use cache"` read layer.
 *
 * Everything the UI reads is produced by the nightly job pipeline, so the read
 * functions in src/lib/queries.ts and src/lib/sentiment-queries.ts are cached
 * with a `days` lifetime and invalidated by tag when the data actually changes:
 *
 *   - RADAR_DATA  — the batch-computed dataset. Expired by the job routes
 *                   (src/app/api/jobs/*) via `revalidateTag(..., "max")` right
 *                   after a refresh/score/alert/brief run completes.
 *   - WATCHLIST   — user-mutable star/watchlist state. Expired by the server
 *                   actions in src/app/watchlist/actions.ts via `updateTag`,
 *                   so a star toggle is visible on the very next request.
 *   - INTRADAY    — the once-a-minute TAIEX tick. Kept off RADAR_DATA on
 *                   purpose: that tag has a `days` cacheLife, so bumping it
 *                   every minute would force every OTHER cached read (radar,
 *                   flows, indicators — none of which change intraday) to
 *                   recompute on the next request for no reason.
 *
 * The CLI entry points (`npm run jobs:daily`, `npm run cron`,
 * `npm run db:backfill`, `npm run import:indicators`) CANNOT call
 * `revalidateTag` themselves: it needs a request/render context and throws
 * outside one, and a script is a different process from the deployed instance
 * whose cache needs clearing. They POST /api/jobs/revalidate instead, via
 * scripts/_revalidate.ts. A job that writes to Postgres and skips that step
 * changes nothing the dashboard shows for up to a day.
 */
export const CACHE_TAGS = {
  radarData: "radar-data",
  watchlist: "watchlist",
  intraday: "intraday",
} as const;
