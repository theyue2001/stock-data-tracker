import { getWatchlist } from "@/lib/queries";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const items = await getWatchlist();
  return ok(items, { count: items.length });
}
