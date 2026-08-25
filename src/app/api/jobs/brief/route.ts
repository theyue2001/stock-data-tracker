import { runDailyBriefJob } from "@/lib/jobs/generate-daily-brief";
import { authorizeJob, ok } from "@/lib/api";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  const brief = await runDailyBriefJob();
  revalidateTag(CACHE_TAGS.radarData, "max");
  return ok({ date: brief.date, generatedBy: brief.generatedBy });
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
