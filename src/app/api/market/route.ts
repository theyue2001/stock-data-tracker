import { getMarketStatus } from "@/lib/queries";
import { fail, ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const market = await getMarketStatus();
  if (!market) return fail("No market status data available", 404);
  return ok(market);
}
