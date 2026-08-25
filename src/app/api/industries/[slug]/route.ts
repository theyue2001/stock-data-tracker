import { getIndustryDetail } from "@/lib/queries";
import { fail, ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const industry = await getIndustryDetail(slug);
  if (!industry) return fail(`Industry "${slug}" not found`, 404);
  return ok(industry);
}
