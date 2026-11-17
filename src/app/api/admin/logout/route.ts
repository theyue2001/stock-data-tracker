import { ADMIN_RESPONSE_HEADERS, clearedAdminSessionCookies, isLocalHost } from "@/lib/health/admin-auth";

/** Clears the session cookie on both of its paths. POST only, so a link
 *  prefetch can never sign anyone out. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:" || !isLocalHost(url.hostname);
  const headers = new Headers({ Location: "/admin/login?signed_out=1", ...ADMIN_RESPONSE_HEADERS });
  for (const cookie of clearedAdminSessionCookies({ secure })) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
