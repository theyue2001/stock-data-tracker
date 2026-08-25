import { getStockRadar } from "@/lib/queries";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  const industry = new URL(request.url).searchParams.get("industry");
  const all = await getStockRadar();
  const stocks = industry ? all.filter((s) => s.industrySlug === industry) : all;
  return ok(stocks, { count: stocks.length, filteredBy: industry ?? null });
}
