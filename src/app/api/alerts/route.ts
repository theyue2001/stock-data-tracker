import { getAlerts } from "@/lib/queries";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limitParam = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(500, limitParam) : 60;
  const alerts = await getAlerts(limit);
  return ok(alerts, { count: alerts.length, limit });
}
