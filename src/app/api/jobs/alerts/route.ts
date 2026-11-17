import { connection } from "next/server";
import { authorizeJob } from "@/lib/api";
import { runAlertsJob } from "@/lib/jobs/pipeline";
import { respondWithJob } from "@/lib/jobs/route-support";
import { triggerFrom } from "@/lib/jobs/run-log";

export const maxDuration = 120;

/** Evaluates the alert rules for the newest scored session (idempotent per session). */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  return respondWithJob(() => runAlertsJob({ trigger: triggerFrom(request) }));
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
