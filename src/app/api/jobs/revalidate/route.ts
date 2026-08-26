import { revalidateTag } from "next/cache";
import { connection } from "next/server";
import { authorizeJob, ok } from "@/lib/api";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * Expires the cached read layer on a running instance.
 *
 * The job routes in this directory invalidate their own caches inline, but the
 * CLI entry points (`npm run jobs:daily`, `npm run cron`, `npm run db:backfill`,
 * `npm run import:indicators`) cannot: `revalidateTag` needs a request/render
 * context and throws outside one, and the deployed instance is a different
 * process from the script anyway. Those scripts POST here instead — see
 * scripts/_revalidate.ts.
 *
 * Guarded by the same CRON_SECRET as the other job routes, because it lets a
 * caller force a full re-render of every cached page.
 *
 * `?tag=intraday` scopes the expiry to the minute-cadence tag instead of the
 * default `radarData` — the intraday poller must not bump the `days`-lifetime
 * tag every run, or every other cached read pays a recompute for a tick only
 * the TAIEX cell shows. See CACHE_TAGS.intraday.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  const requested = new URL(request.url).searchParams.get("tag");
  const tag = requested === "intraday" ? CACHE_TAGS.intraday : CACHE_TAGS.radarData;

  // "max" = stale-while-revalidate: keep serving the current dataset while the
  // fresh one renders, rather than making the next visitor wait for it.
  revalidateTag(tag, "max");

  return ok({ revalidated: tag });
}
