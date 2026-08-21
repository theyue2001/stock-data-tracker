import { getMarketStatus } from "@/lib/queries";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const market = await getMarketStatus();
  if (!market) return fail("No market status data available", 404);
  return ok(market);
}
