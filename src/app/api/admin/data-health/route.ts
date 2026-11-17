import { connection } from "next/server";
import { adminCredential } from "@/app/admin/_lib/require-admin";
import { ADMIN_RESPONSE_HEADERS } from "@/lib/health/admin-auth";
import { getDataHealthReport } from "@/lib/health/queries";

/** The full report behind /admin/data-health as JSON, for a script holding
 *  ADMIN_TOKEN (send it as `Authorization: Bearer <token>`). */
export async function GET() {
  await connection();
  const { credential } = await adminCredential();
  if (credential !== "valid") {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: ADMIN_RESPONSE_HEADERS });
  }
  return Response.json(await getDataHealthReport(new Date()), { headers: ADMIN_RESPONSE_HEADERS });
}
