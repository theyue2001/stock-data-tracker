import { runSourceVerification } from "@/lib/jobs/verify-sources";
import { authorizeJob, fail, ok } from "@/lib/api";
import { connection } from "next/server";

export const maxDuration = 120;

/**
 * Read-only feed-shape check. Writes nothing, so it is safe to schedule and
 * safe to point at production.
 *
 * Returns 503 when any check fails so a platform scheduler surfaces it as a
 * failed invocation rather than a green run with bad news in the body — the
 * whole value here is being told before the numbers reach a decision.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  const result = await runSourceVerification();
  if (result.failed > 0) {
    return fail(
      `${result.failed}/${result.checks.length} source checks failed: ${result.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name} (${c.detail})`)
        .join("; ")}`,
      503,
    );
  }
  return ok(result);
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
