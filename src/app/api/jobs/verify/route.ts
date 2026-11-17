import { connection, NextResponse } from "next/server";
import { runSourceVerification } from "@/lib/jobs/verify-sources";
import { authorizeJob, fail, ok } from "@/lib/api";
import { DATASETS, errorText, startJobRun, triggerFrom } from "@/lib/jobs/run-log";

export const maxDuration = 120;

/**
 * Read-only feed-shape check. Writes nothing to the data tables, so it is safe
 * to schedule and safe to point at production; it needs no pipeline lock.
 *
 * Each probe is logged as a `verify` DatasetRun (provider = probe name, error =
 * what failed) so the health page can show the state of every source without
 * re-running the probes.
 *
 * Returns 503 when any check fails so a platform scheduler surfaces it as a
 * failed invocation rather than a green run with bad news in the body — the
 * whole value here is being told before the numbers reach a decision.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;

  const run = await startJobRun("verify", triggerFrom(request));
  try {
    const result = await runSourceVerification();
    for (const check of result.checks) {
      await run.record(DATASETS.verify, {
        status: check.ok ? "success" : "failed",
        provider: check.name,
        session: null,
        ...(check.ok ? {} : { error: check.detail }),
      });
    }
    await run.finish(undefined, { reason: `${result.passed}/${result.checks.length} source checks passed` });

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
  } catch (err) {
    await run.finish("failed", { error: err });
    return NextResponse.json({ error: errorText(err) }, { status: 500 });
  }
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
