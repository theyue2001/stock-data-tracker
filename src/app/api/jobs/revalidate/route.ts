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
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  // "max" = stale-while-revalidate: keep serving the current dataset while the
  // fresh one renders, rather than making the next visitor wait for it.
  revalidateTag(CACHE_TAGS.radarData, "max");

  return ok({ revalidated: CACHE_TAGS.radarData });
}
