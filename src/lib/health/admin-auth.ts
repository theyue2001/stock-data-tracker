/**
 * Admin-area authentication: one shared ADMIN_TOKEN, presented either as
 * `Authorization: Bearer <token>` (scripts, monitors) or through the cookie
 * the /admin/login form sets (a browser).
 *
 * Used by src/proxy.ts (the gate), by the login/logout route handlers, and
 * again inside the admin page and API as a second check — the proxy matcher
 * is configuration, and a refactor that narrows it must not silently expose
 * the page.
 *
 * Web Crypto only (no node:crypto) so this runs unchanged in the proxy
 * whichever runtime it is deployed to.
 */

export const ADMIN_COOKIE = "admin_session";

/** The cookie is scoped to exactly the two trees the proxy guards and is
 *  never sent to the public site. A cookie has one path, so it is set twice. */
export const ADMIN_COOKIE_PATHS = ["/admin", "/api/admin"] as const;

export const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Paths under the guarded trees that must stay reachable without a session. */
export const PUBLIC_ADMIN_PATHS: ReadonlySet<string> = new Set(["/admin/login", "/api/admin/login", "/api/admin/logout"]);

export const DEFAULT_ADMIN_PATH = "/admin/data-health";

/** Sent on every admin response: never indexed, never cached by a CDN or the browser. */
export const ADMIN_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

export type AdminAuthMode =
  | { mode: "token"; token: string }
  /** No ADMIN_TOKEN outside production: open, with a banner (mirrors authorizeJob). */
  | { mode: "open-dev" }
  /** No ADMIN_TOKEN in production: the admin area answers 503. */
  | { mode: "unconfigured" };

export function adminAuthMode(env: Record<string, string | undefined> = process.env): AdminAuthMode {
  const token = env.ADMIN_TOKEN;
  if (token && token.trim() !== "") return { mode: "token", token };
  return env.NODE_ENV === "production" ? { mode: "unconfigured" } : { mode: "open-dev" };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares in time independent of where the strings differ. Length is not
 *  secret here: every caller compares two SHA-256 hex digests. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hashes both sides first so neither the token's length nor a matching
 *  prefix shows up in the comparison time. */
export async function tokenMatches(presented: string, token: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(presented), sha256Hex(token)]);
  return constantTimeEqual(a, b);
}

/**
 * The cookie value: a SHA-256 of the token, never the token itself, so the
 * token cannot be read back out of a browser profile or a request log.
 * Rotating ADMIN_TOKEN invalidates every session. The prefix keeps this
 * digest distinct from a bare hash of the token used anywhere else.
 */
export function adminSessionValue(token: string): Promise<string> {
  return sha256Hex(`admin-session:v1:${token}`);
}

export type AdminCredential = "valid" | "invalid-bearer" | "invalid-cookie" | "none";

/** An Authorization header, when present, is the credential being presented
 *  and is judged alone; the cookie is only consulted without one. */
export async function checkAdminCredential(
  input: { authorization: string | null; cookie: string | null },
  token: string,
): Promise<AdminCredential> {
  if (input.authorization !== null) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(input.authorization);
    return m && (await tokenMatches(m[1], token)) ? "valid" : "invalid-bearer";
  }
  if (input.cookie) return constantTimeEqual(input.cookie, await adminSessionValue(token)) ? "valid" : "invalid-cookie";
  return "none";
}

/** Plain-HTTP local development cannot store a `Secure` cookie in every
 *  browser; everywhere else the cookie is HTTPS-only. */
export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost");
}

function cookieAttributes(path: string, secure: boolean): string[] {
  return [`Path=${path}`, "HttpOnly", "SameSite=Strict", ...(secure ? ["Secure"] : [])];
}

export function adminSessionCookies(value: string, opts: { secure: boolean; maxAgeSeconds?: number }): string[] {
  const maxAge = opts.maxAgeSeconds ?? ADMIN_SESSION_MAX_AGE_SECONDS;
  return ADMIN_COOKIE_PATHS.map((path) => [`${ADMIN_COOKIE}=${value}`, `Max-Age=${maxAge}`, ...cookieAttributes(path, opts.secure)].join("; "));
}

export function clearedAdminSessionCookies(opts: { secure: boolean }): string[] {
  return ADMIN_COOKIE_PATHS.map((path) =>
    [`${ADMIN_COOKIE}=`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT", ...cookieAttributes(path, opts.secure)].join("; "),
  );
}

/**
 * Where to send the browser after login. Only a path inside the admin tree
 * is accepted, so the login form cannot be used as an open redirect.
 */
export function safeAdminPath(next: unknown): string {
  if (typeof next !== "string") return DEFAULT_ADMIN_PATH;
  if (!/^\/admin(\/[\x21-\x7e]*)?$/.test(next)) return DEFAULT_ADMIN_PATH;
  if (next.includes("\\") || next.startsWith("/admin/login")) return DEFAULT_ADMIN_PATH;
  return next;
}
