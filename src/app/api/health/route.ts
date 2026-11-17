import { connection } from "next/server";
import { getPublicHealth } from "@/lib/health/queries";
import { publicHealth } from "@/lib/health/status";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * Public, unauthenticated freshness summary for an uptime monitor: 200 while
 * the stored data is current (or still inside its publication window), 503
 * when it is stale or a required dataset failed. Verdict and dates only — no
 * error text, provider names or anything else internal.
 */
export async function GET() {
  await connection();
  const now = new Date();
  try {
    const body = await getPublicHealth(now);
    return Response.json(body, { status: body.ok ? 200 : 503, headers: HEADERS });
  } catch (err) {
    // The database being unreachable is itself the outage a monitor should
    // see. The cause goes to the server log, never into the response.
    console.error("[api/health] health check failed:", err instanceof Error ? err.message : err);
    const unknown = publicHealth({ latestSession: null, datasets: [], tick: null }, now);
    return Response.json({ ...unknown, ok: false, status: "failed" }, { status: 503, headers: HEADERS });
  }
}
