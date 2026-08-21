import { getWatchlist } from "@/lib/queries";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getWatchlist();
  return ok(items, { count: items.length });
}
