import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { ok } from "@/lib/api";
import { errorText } from "./run-log";
import type { PipelineResult } from "./pipeline";

/**
 * Shared tail of the job route handlers in src/app/api/jobs/.
 *
 * Expiry is IMMEDIATE (`{ expire: 0 }`), not `"max"`. With "max" the tag is
 * only marked stale, and the next visitor is served the pre-job page while the
 * fresh one renders in the background — which on a low-traffic dashboard means
 * whoever opens it first after the evening run sees yesterday's session. The
 * Next 16 docs name `{ expire: 0 }` as the Route Handler form for exactly this
 * (revalidateTag.md, "Good to know"; updateTag is Server-Action only).
 */
export function expireTag(tag: string = CACHE_TAGS.radarData): void {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch (err) {
    // The data is already written; a failed expiry is staleness, not a job failure.
    console.error(`[jobs] could not expire cache tag ${tag}:`, errorText(err));
  }
}

/**
 * Runs a job and turns its result into the HTTP response.
 *
 * The cache is expired after ANY run that wrote rows — including partial runs
 * and runs whose alerts or brief step failed, since the prices and scores they
 * did write are exactly what a stale page would hide. A skipped run wrote
 * nothing and leaves the cache alone.
 *
 * 200 for success / partial / skipped (a session still waiting for flows is
 * the normal state of an evening poll, not an error); 500 when the run failed
 * outright, so a scheduler's `--fail` surfaces it.
 */
export async function respondWithJob(work: () => Promise<PipelineResult>): Promise<NextResponse> {
  let result: PipelineResult;
  try {
    result = await work();
  } catch (err) {
    // The job functions finish their own JobRun and do not throw; this is the
    // backstop for anything outside them. Expire anyway: whether rows landed
    // before the throw is unknown, and an extra re-render is cheap.
    expireTag();
    console.error("[jobs] route failed:", errorText(err));
    return NextResponse.json({ error: errorText(err) }, { status: 500 });
  }

  if (result.wroteData) expireTag();
  if (result.status === "failed") {
    return NextResponse.json({ error: `job ${result.status}`, data: result }, { status: 500 });
  }
  return ok(result);
}
