import { getCapitalFlow } from "@/lib/queries";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET() {
  await connection();
  return ok(await getCapitalFlow());
}
