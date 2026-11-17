import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_RESPONSE_HEADERS,
  PUBLIC_ADMIN_PATHS,
  adminAuthMode,
  checkAdminCredential,
} from "@/lib/health/admin-auth";

/**
 * Gate for the admin area (/admin/*, /api/admin/*) — the only thing this
 * proxy does. The admin page and API repeat the credential check themselves
 * (src/app/admin/_lib/require-admin.ts), so narrowing this matcher by mistake
 * cannot expose them.
 *
 *   ADMIN_TOKEN set      → Bearer header or the login cookie; otherwise pages
 *                          redirect to /admin/login, APIs (and any request
 *                          presenting a wrong Bearer) get 401 JSON.
 *   unset, development   → open, and the page shows a banner saying so.
 *   unset, production    → 503 for the whole admin area, login included.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const auth = adminAuthMode();

  if (auth.mode === "unconfigured") {
    const message = "ADMIN_TOKEN is not configured";
    return withAdminHeaders(
      isApi
        ? NextResponse.json({ error: message }, { status: 503 })
        : new NextResponse(message, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
    );
  }
  if (auth.mode === "open-dev" || PUBLIC_ADMIN_PATHS.has(pathname)) return withAdminHeaders(NextResponse.next());

  const credential = await checkAdminCredential(
    { authorization: request.headers.get("authorization"), cookie: request.cookies.get(ADMIN_COOKIE)?.value ?? null },
    auth.token,
  );
  if (credential === "valid") return withAdminHeaders(NextResponse.next());

  // A client that sent a Bearer token is a script or monitor: tell it the
  // token is wrong instead of redirecting it to an HTML form.
  if (isApi || credential === "invalid-bearer") {
    return withAdminHeaders(
      NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="admin"' } }),
    );
  }
  const login = new URL("/admin/login", request.url);
  if (pathname !== "/admin") login.searchParams.set("next", `${pathname}${search}`);
  return withAdminHeaders(NextResponse.redirect(login, 303));
}

function withAdminHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(ADMIN_RESPONSE_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
