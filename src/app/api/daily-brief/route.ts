import { getLatestDailyBrief } from "@/lib/queries";
import { fail, ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const brief = await getLatestDailyBrief();
  if (!brief) return fail("No daily brief has been generated yet", 404);
  return ok(brief);
}
