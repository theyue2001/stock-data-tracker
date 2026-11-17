import {
  ADMIN_RESPONSE_HEADERS,
  adminAuthMode,
  adminSessionCookies,
  adminSessionValue,
  isLocalHost,
  safeAdminPath,
  tokenMatches,
} from "@/lib/health/admin-auth";

/** Slows a wrong guess down; ADMIN_TOKEN should be long and random anyway. */
const FAILED_LOGIN_DELAY_MS = 500;

/**
 * POST target of the /admin/login form. On a match, sets the session cookie
 * (a SHA-256 of the token, never the token) and sends the browser on with a
 * 303 so a reload does not resubmit the form.
 */
export async function POST(request: Request) {
  const auth = adminAuthMode();
  if (auth.mode === "unconfigured") {
    return Response.json({ error: "ADMIN_TOKEN is not configured" }, { status: 503, headers: ADMIN_RESPONSE_HEADERS });
  }

  const form = await request.formData().catch(() => null);
  const next = safeAdminPath(form?.get("next"));
  if (auth.mode === "open-dev") return seeOther(next);

  const presented = form?.get("token");
  if (typeof presented !== "string" || presented === "" || !(await tokenMatches(presented, auth.token))) {
    await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
    return seeOther(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const url = new URL(request.url);
  const secure = url.protocol === "https:" || !isLocalHost(url.hostname);
  return seeOther(next, adminSessionCookies(await adminSessionValue(auth.token), { secure }));
}

/** A relative Location keeps the redirect on whatever host the browser used. */
function seeOther(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, ...ADMIN_RESPONSE_HEADERS });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
