import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminAuthMode, checkAdminCredential, type AdminCredential } from "@/lib/health/admin-auth";

/**
 * The second credential check behind src/proxy.ts. The proxy is the gate,
 * but its matcher is configuration: if a refactor ever narrows it, this keeps
 * the admin page and API closed instead of silently public.
 */
export async function adminCredential(): Promise<{ mode: "token" | "open-dev"; credential: AdminCredential }> {
  const auth = adminAuthMode();
  if (auth.mode === "unconfigured") throw new Error("ADMIN_TOKEN is not configured");
  if (auth.mode === "open-dev") return { mode: "open-dev", credential: "valid" };
  const [h, c] = await Promise.all([headers(), cookies()]);
  const credential = await checkAdminCredential({ authorization: h.get("authorization"), cookie: c.get(ADMIN_COOKIE)?.value ?? null }, auth.token);
  return { mode: "token", credential };
}

/** For a page: redirects to the login form unless the request is authenticated. */
export async function requireAdminPage(path: string): Promise<"token" | "open-dev"> {
  const { mode, credential } = await adminCredential();
  if (credential !== "valid") redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  return mode;
}
