import { runDailyBriefJob } from "@/lib/jobs/generate-daily-brief";
import { authorizeJob, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  const brief = await runDailyBriefJob();
  return ok({ date: brief.date, generatedBy: brief.generatedBy });
}
