import { NextResponse } from "next/server";

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json({
    data,
    meta: {
      // Everything served by this MVP is synthetic demo data. Clients should
      // surface this rather than presenting values as real market data.
      isDemoData: true,
      generatedAt: new Date().toISOString(),
      ...meta,
    },
  });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Guards the job-trigger routes. Set CRON_SECRET in the environment and send
 * it as `Authorization: Bearer <secret>` or `x-cron-secret`. When no secret is
 * configured the routes are allowed only outside production, so a deployed
 * instance can never be triggered anonymously by accident.
 */
export function authorizeJob(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        response: NextResponse.json({ error: "CRON_SECRET is not configured on the server" }, { status: 503 }),
      };
    }
    return { ok: true };
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const provided = bearer ?? request.headers.get("x-cron-secret");

  if (provided !== secret) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true };
}
