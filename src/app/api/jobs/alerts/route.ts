import { runAlertEngine } from "@/lib/jobs/generate-alerts";
import { authorizeJob, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = authorizeJob(request);
  if (!auth.ok) return auth.response;
  return ok({ created: await runAlertEngine() });
}
