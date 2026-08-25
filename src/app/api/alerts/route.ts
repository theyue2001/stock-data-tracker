import { getAlerts } from "@/lib/queries";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(500, limitParam) : 60;
  const alerts = await getAlerts(limit);
  return ok(alerts, { count: alerts.length, limit });
}
