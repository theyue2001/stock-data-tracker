import { connection } from "next/server";
import { authorizeJob } from "@/lib/api";
import { runBriefJob } from "@/lib/jobs/pipeline";
import { respondWithJob } from "@/lib/jobs/route-support";
import { triggerFrom } from "@/lib/jobs/run-log";

export const maxDuration = 120;

/** (Re)generates the daily brief for the newest scored session. */
export async function POST(request: Request) {
  await connection();
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  return respondWithJob(() => runBriefJob({ trigger: triggerFrom(request) }));
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
