import { connection } from "next/server";
import { authorizeJob } from "@/lib/api";
import { runDailyPipeline } from "@/lib/jobs/pipeline";
import { respondWithJob } from "@/lib/jobs/route-support";
import { triggerFrom } from "@/lib/jobs/run-log";

export const maxDuration = 300;

/**
 * The data half of the pipeline — prices, flows, fundamentals, technicals,
 * scores, sentiment — without alerts or the brief. Like /api/jobs/daily it
 * runs only what the session still lacks; `?force=1` re-runs every dataset
 * once, e.g. to pick up flows that were published after the deadline.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  const force = ["1", "true"].includes(new URL(request.url).searchParams.get("force") ?? "");
  return respondWithJob(() => runDailyPipeline({ trigger: triggerFrom(request), job: "refresh", force }));
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
