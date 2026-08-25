import { runRefreshJob } from "@/lib/jobs/refresh-data";
import { authorizeJob, ok } from "@/lib/api";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  const result = await runRefreshJob();
  // The screens read this dataset through cached functions; expire them so the
  // next visitor sees the new session instead of yesterday's prerender.
  revalidateTag(CACHE_TAGS.radarData, "max");
  return ok(result);
}

// Vercel Cron only sends GET; alias it to the same handler.
export const GET = POST;
