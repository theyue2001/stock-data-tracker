import { connection } from "next/server";
import { authorizeJob } from "@/lib/api";
import { runDailyPipeline } from "@/lib/jobs/pipeline";
import { respondWithJob } from "@/lib/jobs/route-support";
import { triggerFrom } from "@/lib/jobs/run-log";

export const maxDuration = 300;

/**
 * The after-hours pipeline. Built to be polled every 5 minutes from 13:30 to
 * midnight Taipei (see .github/workflows/scheduled-jobs.yml): each call runs
 * only what the newest published session still lacks, so a call with nothing
 * to do costs one upstream request and a few reads. See runDailyPipeline for
 * the completion and retry rules.
 */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  return respondWithJob(() => runDailyPipeline({ trigger: triggerFrom(request) }));
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
