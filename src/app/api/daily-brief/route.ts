import { getLatestDailyBrief } from "@/lib/queries";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const brief = await getLatestDailyBrief();
  if (!brief) return fail("No daily brief has been generated yet", 404);
  return ok(brief);
}
