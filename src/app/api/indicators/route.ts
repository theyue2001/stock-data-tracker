import { getIndicatorOverview } from "@/lib/queries";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  const industry = new URL(request.url).searchParams.get("industry");
  const all = await getIndicatorOverview();
  const indicators = industry ? all.filter((i) => i.industrySlug === industry) : all;
  return ok(indicators, { count: indicators.length, filteredBy: industry ?? null });
}
