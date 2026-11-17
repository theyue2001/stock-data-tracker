/**
 * Shared HTTP layer for every live data provider.
 *
 * The Taiwan exchange endpoints are public but rate-limited and, in the case
 * of MOPS, still served as Big5 HTML. Four concerns are handled here once so
 * no individual provider has to:
 *
 *  1. Per-host throttling. www.twse.com.tw blocks a client that bursts —
 *     roughly three requests per five seconds is the practical ceiling, and
 *     being blocked costs minutes, not milliseconds. Requests to a host are
 *     serialized through a promise chain with a minimum spacing rather than
 *     fired concurrently, so a backfill that walks 55 stocks x 6 months stays
 *     inside the limit without every caller remembering to sleep.
 *  2. Retry on 408/429/5xx/network errors/timeouts, with full-jitter
 *     exponential backoff that never undercuts the host's own spacing, and
 *     with the server's `Retry-After` honoured on 429/503. A single transient
 *     failure mid-backfill would otherwise leave a hole in the price history
 *     that the technical indicators silently compute around.
 *  3. Typed failures. Every non-2xx response becomes an `HttpStatusError`
 *     (src/lib/providers/errors.ts) — `HttpError`, or `BlockedError` for the
 *     TWSE block page — so the job log can record the status code instead of
 *     a bare message.
 *  4. Encoding. MOPS monthly-revenue pages are Big5; everything else is UTF-8.
 */
import { HttpStatusError } from "@/lib/providers/errors";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Per-attempt request timeout when the caller does not pass `timeoutMs`. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Minimum milliseconds between two requests to the same host. Tuned to what
 * each endpoint tolerates: the interactive TWSE site is by far the strictest,
 * the OpenAPI CDN the most permissive, and SEC asks only for a declared UA.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  // Measured the hard way: an earlier 2.2 s spacing tripped an IP block on
  // the interactive TWSE site after roughly 150 requests to one report path,
  // hence the 4 s used now. See BlockedError below.
  "www.twse.com.tw": 4000,
  "openapi.twse.com.tw": 400,
  "mopsov.twse.com.tw": 2000,
  "www.tpex.org.tw": 1500,
  "data.sec.gov": 200,
  // The real-time quote host. Its POLL cadence is not set here but by the
  // intraday provider's `minIntervalSeconds` (see intraday-provider.ts); this
  // value only spaces a retry or a verify probe that lands right after a
  // tick. Stated explicitly rather than left to FALLBACK_INTERVAL_MS so a
  // future change to that default can't silently retune it.
  "mis.twse.com.tw": 1000,
};
const FALLBACK_INTERVAL_MS = 1000;

/**
 * Extra spacing applied to a host after it has signalled throttling, for the
 * rest of the process. Backing off only for the failed request is not enough:
 * the block is stateful on their side, so continuing at the previous pace
 * simply re-triggers it.
 */
const throttlePenaltyMs = new Map<string, number>();
const PENALTY_STEP_MS = 4000;
const PENALTY_CEILING_MS = 30_000;

/** Per-host tail of the request chain, so requests to one host queue behind
 *  each other while different hosts still proceed in parallel. */
const hostQueue = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Current spacing for a host: its base interval plus any throttle penalty. */
function hostInterval(host: string): number {
  return (HOST_MIN_INTERVAL_MS[host] ?? FALLBACK_INTERVAL_MS) + (throttlePenaltyMs.get(host) ?? 0);
}

/** Serializes `task` behind any pending request to the same host, spaced by
 *  that host's minimum interval plus any throttle penalty it has earned. */
function enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
  const prior = hostQueue.get(host) ?? Promise.resolve();
  const run = prior.then(task);
  // The spacing delays the NEXT request to the host, not this caller's
  // result, and applies after failures too: a request that just failed is
  // exactly the moment not to hit the host again immediately. `.catch` keeps
  // one failed request from poisoning every later request on the same host —
  // the chain is a scheduler, not an error channel.
  hostQueue.set(
    host,
    run.catch(() => {}).then(() => sleep(hostInterval(host))),
  );
  return run;
}

/**
 * A non-2xx response from `fetchText`. It is an `HttpStatusError`, so
 * `httpStatusOf` in the job log picks the status up; it keeps its own name
 * because providers already test `instanceof HttpError` for the
 * "404 means the report does not exist for that date" case.
 */
export class HttpError extends HttpStatusError {
  /** The response's Retry-After, in ms from when it arrived; null when absent or unparseable. */
  readonly retryAfterMs: number | null;
  constructor(status: number, url: string, retryAfterMs: number | null = null) {
    const hint = retryAfterMs === null ? "" : ` (Retry-After ${Math.ceil(retryAfterMs / 1000)} s)`;
    super(status, url, `HTTP ${status} for ${url}${hint}`);
    this.name = "HttpError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The interactive TWSE site has refused this client.
 *
 * TWSE answers a blocked client with a 307 carrying no `Location` and a Chinese
 * "for security reasons this page cannot be accessed" body — so it is neither a
 * redirect fetch can follow nor a 429 a generic retry would recognise. The
 * block is scoped to the report path and lasts well beyond any sane retry
 * window, which makes it categorically different from a transient failure:
 * retrying is not just useless, it extends the block.
 *
 * Carries the response status (307 in every block observed) so the job log
 * records it like any other HTTP failure.
 *
 * Callers should treat this as "this leg is unavailable for now", keep whatever
 * they have already collected, and resume later — never as a run-ending error.
 */
export class BlockedError extends HttpStatusError {
  constructor(url: string, status = 307) {
    super(
      status,
      url,
      `TWSE has temporarily blocked this client for ${new URL(url).pathname} (HTTP ${status}). ` +
        `Wait for the block to lapse and re-run; the backfill resumes from what is already stored.`,
    );
    this.name = "BlockedError";
  }
}

/**
 * Requests already made to a host this process, and an optional ceiling.
 *
 * The TWSE limiter is a rolling quota, not a ban: a blocked client is serving
 * again within minutes. That makes the winning strategy "stay under the quota
 * and come back later" rather than "retry harder" — so a bulk collector sets a
 * budget it knows is safe, stops cleanly when it is spent, and resumes on the
 * next run. Without a budget every run races to the limit and gets cut off at
 * an arbitrary point.
 */
const hostRequestCount = new Map<string, number>();
const hostRequestBudget = new Map<string, number>();

export class BudgetExhaustedError extends Error {
  constructor(
    readonly host: string,
    readonly budget: number,
  ) {
    super(
      `Request budget of ${budget} for ${host} is spent for this run. ` +
        `Re-run later to continue; nothing already stored is refetched.`,
    );
    this.name = "BudgetExhaustedError";
  }
}

/** Caps how many requests this process will make to `host`. */
export function setRequestBudget(host: string, budget: number): void {
  hostRequestBudget.set(host, budget);
}

/**
 * Overrides a host's minimum request spacing for this process.
 *
 * The defaults above are sized for BULK collection, where hundreds of
 * sequential requests to www.twse.com.tw will trip its rolling quota. A job
 * that makes only a handful is in no danger of that, and paying 4 s of spacing
 * per request turns a six-request job into half a minute of sleeping — which is
 * what pushes the nightly refresh past a serverless function's time limit.
 *
 * Only lower this where the request count is bounded and small. (No caller
 * uses it today; it is kept for exactly that kind of job.)
 */
export function setHostInterval(host: string, ms: number): void {
  HOST_MIN_INTERVAL_MS[host] = ms;
}

export function requestsMade(host: string): number {
  return hostRequestCount.get(host) ?? 0;
}

// ---------------------------------------------------------------------------
// Retry policy (pure, unit-tested in http.test.ts)
// ---------------------------------------------------------------------------

/** First backoff ceiling. Generous because the failure being retried is
 *  usually "the exchange throttled us", which a fast retry re-triggers. */
export const RETRY_BASE_MS = 1500;
/** Largest backoff ceiling, however many attempts deep. */
export const RETRY_CAP_MS = 30_000;
/**
 * Longest `Retry-After` this client will wait out. Every request to the host
 * queues behind the wait, so a server asking for longer is answered by giving
 * up on this request (the error carries the hint) rather than by holding the
 * whole host for minutes — or by retrying early against its explicit request.
 */
export const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Full-jitter exponential backoff: a uniform random wait in
 * [0, min(cap, base * 2^attempt)), so a fleet of clients that failed together
 * does not retry together. Raised to `floorMs` — the host's own request
 * spacing — because a retry is still a request to a rate-limited host and
 * must never come sooner than a normal one would.
 */
export function backoffDelay(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; floorMs?: number; random?: () => number } = {},
): number {
  const { baseMs = RETRY_BASE_MS, capMs = RETRY_CAP_MS, floorMs = 0, random = Math.random } = opts;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.max(floorMs, Math.floor(random() * ceiling));
}

/**
 * Parses a `Retry-After` header into milliseconds from `now`. RFC 9110 allows
 * either delay-seconds ("120") or an HTTP-date ("Wed, 18 Nov 2026 01:00:00 GMT").
 * A date in the past means "now" (0). Anything else — negative or fractional
 * seconds, free text — is null, i.e. "no usable hint", never a guess.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  // An HTTP-date always opens with a day name (IMF-fixdate, RFC 850 and
  // asctime forms alike); requiring it keeps Date.parse's leniency from
  // turning "1.5" or "-5" into a date.
  if (!/^[A-Za-z]{3,9},? /.test(text)) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * How long to wait before retrying `error` after attempt `attempt` (0-based),
 * or null when it must not be retried:
 *  - 404 and other 4xx: the report genuinely does not exist for that date (a
 *    holiday, a month before the stock listed) or the request is wrong.
 *  - BlockedError: retrying extends the block; fetchText handles it apart.
 *  - 429/503 with a Retry-After beyond RETRY_AFTER_CAP_MS (see there).
 * 429/503 with a usable Retry-After wait exactly that (but never less than
 * `floorMs`); everything else retryable uses `backoffDelay`.
 */
export function retryDelay(
  error: unknown,
  attempt: number,
  opts: { floorMs?: number; random?: () => number } = {},
): number | null {
  const floorMs = opts.floorMs ?? 0;
  if (error instanceof BlockedError) return null;
  if (error instanceof HttpStatusError) {
    const s = error.status;
    if (s !== 408 && s !== 429 && s < 500) return null;
    const hint = error instanceof HttpError ? error.retryAfterMs : null;
    if ((s === 429 || s === 503) && hint !== null) {
      return hint > RETRY_AFTER_CAP_MS ? null : Math.max(floorMs, hint);
    }
  }
  // 408 / 429 / 5xx without a hint, network errors, timeouts.
  return backoffDelay(attempt, { floorMs, random: opts.random });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** How long to wait out a block before trying the same request once more. */
const BLOCK_COOLDOWN_MS = 180_000;

const BLOCK_MARKERS = ["FOR SECURITY REASONS", "因為安全性考量"];

function looksLikeBlockPage(status: number, body: string): boolean {
  // Matched on the body rather than the status alone: 3xx from this host is
  // only ever the block page, but checking the text keeps a future genuine
  // redirect from being misread as a block.
  return status >= 300 && status < 400 && BLOCK_MARKERS.some((m) => body.includes(m));
}

interface FetchOptions {
  /** Response encoding. "big5" is only needed for MOPS legacy pages. */
  encoding?: "utf-8" | "big5";
  /** Retries after the first attempt (default 3). */
  retries?: number;
  /** Per-attempt timeout in ms (default DEFAULT_TIMEOUT_MS), covering the body read too. */
  timeoutMs?: number;
  /** Extra headers; a Referer is required by some TPEx endpoints. */
  headers?: Record<string, string>;
  /**
   * Bypasses the response cache below, in both directions.
   *
   * Required by any caller polling faster than CACHE_TTL_MS for a value that
   * genuinely changes at that rate — the real-time quote feed. Without it the
   * intraday poller running inside the long-lived `npm run cron` process would
   * re-serve the same 10-minute-old tick for nine of every ten polls, which
   * looks exactly like the market having gone flat.
   */
  noCache?: boolean;
  /**
   * Whether a block page earns one BLOCK_COOLDOWN_MS wait and a second try
   * (default true). A periodic poller passes false: its next scheduled tick
   * IS the retry, and three minutes asleep in the host queue would only
   * collide with it.
   */
  blockCooldown?: boolean;
}

async function fetchTextOnce(url: string, opts: FetchOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "application/json, text/html;q=0.9, */*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        ...opts.headers,
      },
    });

    if (!response.ok) {
      // Read the body before deciding: the block page is only distinguishable
      // from a real redirect by its content.
      const body = await response.text().catch(() => "");
      if (looksLikeBlockPage(response.status, body)) {
        const host = new URL(url).host;
        throttlePenaltyMs.set(
          host,
          Math.min(PENALTY_CEILING_MS, (throttlePenaltyMs.get(host) ?? 0) + PENALTY_STEP_MS),
        );
        throw new BlockedError(url, response.status);
      }
      throw new HttpError(response.status, url, parseRetryAfter(response.headers.get("retry-after")));
    }

    const buffer = await response.arrayBuffer();
    return new TextDecoder(opts.encoding ?? "utf-8").decode(buffer);
  } catch (error) {
    // AbortSignal.timeout rejects with a bare DOMException that names neither
    // the URL nor the limit; the job log needs both.
    if (error instanceof Error && error.name === "TimeoutError") {
      const timeout = new Error(`Timed out after ${timeoutMs} ms: ${url}`);
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  }
}

function describe(error: unknown): string {
  if (error instanceof HttpStatusError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : "error";
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 3;

  const budget = hostRequestBudget.get(host);
  if (budget !== undefined && (hostRequestCount.get(host) ?? 0) >= budget) {
    // Thrown before queueing, so an exhausted budget costs nothing and the
    // caller stops immediately rather than draining a queue of doomed work.
    throw new BudgetExhaustedError(host, budget);
  }

  return enqueue(host, async () => {
    let attempt = 0;
    // A block gets exactly one cooldown-and-retry, outside the normal retry
    // count. The quota refills on a timer, so one long wait often clears it —
    // but a second block means the window is genuinely spent and grinding at
    // it only extends the lockout.
    let cooledDown = false;

    for (;;) {
      try {
        hostRequestCount.set(host, (hostRequestCount.get(host) ?? 0) + 1);
        return await fetchTextOnce(url, opts);
      } catch (error) {
        if (error instanceof BlockedError) {
          if (cooledDown || opts.blockCooldown === false) throw error;
          cooledDown = true;
          console.warn(
            `[http] ${host} throttled after ${hostRequestCount.get(host)} requests; waiting ${BLOCK_COOLDOWN_MS / 1000}s`,
          );
          await sleep(BLOCK_COOLDOWN_MS);
          continue;
        }

        const wait = attempt < retries ? retryDelay(error, attempt, { floorMs: hostInterval(host) }) : null;
        if (wait === null) throw error;
        attempt++;
        console.warn(`[http] ${host} ${describe(error)}; retry ${attempt}/${retries} in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
      }
    }
  });
}

/**
 * Short-lived response cache, keyed by URL.
 *
 * Several reports serve more than one provider — MI_MARGN carries both the
 * market-wide credit summary and the per-stock balances, for instance — and a
 * backfill would otherwise re-request the same URL once per consumer, paying
 * the host's full spacing (4 s on www.twse.com.tw) each time. The TTL keeps a
 * long-running scheduler from serving a stale session after the exchange
 * publishes the next one.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const responseCache = new Map<string, { at: number; value: unknown }>();

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  if (!opts.noCache) {
    const cached = responseCache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value as T;
  }

  const text = await fetchText(url, opts);
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${url}, got ${text.slice(0, 120)}`);
  }
  if (!opts.noCache) responseCache.set(url, { at: Date.now(), value: parsed });
  return parsed;
}

/**
 * Fetches an endpoint that is allowed to be absent (a holiday date, a month
 * before a stock listed), returning null instead of throwing on 404.
 */
export async function fetchJsonOptional<T>(url: string, opts: FetchOptions = {}): Promise<T | null> {
  try {
    return await fetchJson<T>(url, opts);
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) return null;
    throw error;
  }
}
