/**
 * Shared HTTP layer for every live data provider.
 *
 * The Taiwan exchange endpoints are public but rate-limited and, in the case
 * of MOPS, still served as Big5 HTML. Three concerns are handled here once so
 * no individual provider has to:
 *
 *  1. Per-host throttling. www.twse.com.tw blocks a client that bursts —
 *     roughly three requests per five seconds is the practical ceiling, and
 *     being blocked costs minutes, not milliseconds. Requests to a host are
 *     serialized through a promise chain with a minimum spacing rather than
 *     fired concurrently, so a backfill that walks 55 stocks x 6 months stays
 *     inside the limit without every caller remembering to sleep.
 *  2. Retry with backoff on 429/5xx/network errors, since a single transient
 *     failure mid-backfill would otherwise leave a hole in the price history
 *     that the technical indicators silently compute around.
 *  3. Encoding. MOPS monthly-revenue pages are Big5; everything else is UTF-8.
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Minimum milliseconds between two requests to the same host. Tuned to what
 * each endpoint tolerates: the interactive TWSE site is by far the strictest,
 * the OpenAPI CDN the most permissive, and SEC asks only for a declared UA.
 */
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  // Measured the hard way: sustained iteration at 2.2 s tripped an IP block on
  // the interactive TWSE site after roughly 150 requests to one report path.
  // See BlockedError below.
  "www.twse.com.tw": 4000,
  "openapi.twse.com.tw": 400,
  "mopsov.twse.com.tw": 2000,
  "www.tpex.org.tw": 1500,
  "data.sec.gov": 200,
  // The real-time quote host, polled once a minute during the session. Stated
  // explicitly rather than left to FALLBACK_INTERVAL_MS (same value today) so
  // a future change to that default can't silently retune a live poller.
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

/** Serializes `task` behind any pending request to the same host, spaced by
 *  that host's minimum interval plus any throttle penalty it has earned. */
function enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
  const interval =
    (HOST_MIN_INTERVAL_MS[host] ?? FALLBACK_INTERVAL_MS) + (throttlePenaltyMs.get(host) ?? 0);
  const prior = hostQueue.get(host) ?? Promise.resolve();
  // `.catch` keeps one failed request from poisoning every later request on
  // the same host — the chain is a scheduler, not an error channel.
  const next = prior.catch(() => {}).then(async () => {
    const result = await task();
    await sleep(interval);
    return result;
  });
  hostQueue.set(host, next);
  return next;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
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
 * Callers should treat this as "this leg is unavailable for now", keep whatever
 * they have already collected, and resume later — never as a run-ending error.
 */
export class BlockedError extends Error {
  constructor(readonly url: string) {
    super(
      `TWSE has temporarily blocked this client for ${new URL(url).pathname}. ` +
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
 * Only lower this where the request count is bounded and small.
 */
export function setHostInterval(host: string, ms: number): void {
  HOST_MIN_INTERVAL_MS[host] = ms;
}

export function requestsMade(host: string): number {
  return hostRequestCount.get(host) ?? 0;
}

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
  retries?: number;
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
}

async function fetchTextOnce(url: string, opts: FetchOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
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
        throw new BlockedError(url);
      }
      throw new HttpError(response.status, url);
    }

    const buffer = await response.arrayBuffer();
    return new TextDecoder(opts.encoding ?? "utf-8").decode(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retryable = transient. Three cases are deliberately NOT retried:
 *  - 404: the report genuinely does not exist for that date (a holiday, or a
 *    month before the stock listed).
 *  - BlockedError: retrying extends the block rather than clearing it.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof BlockedError) return false;
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return true; // network error / abort
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
    let lastError: unknown;
    // A block gets exactly one cooldown-and-retry. The quota refills on a
    // timer, so one long wait often clears it — but a second block means the
    // window is genuinely spent and grinding at it only extends the lockout.
    let cooldownsUsed = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        hostRequestCount.set(host, (hostRequestCount.get(host) ?? 0) + 1);
        return await fetchTextOnce(url, opts);
      } catch (error) {
        lastError = error;

        if (error instanceof BlockedError && cooldownsUsed === 0) {
          cooldownsUsed++;
          console.warn(
            `[http] ${host} throttled after ${hostRequestCount.get(host)} requests; waiting ${BLOCK_COOLDOWN_MS / 1000}s`,
          );
          await sleep(BLOCK_COOLDOWN_MS);
          continue;
        }

        if (!isRetryable(error) || attempt === retries) break;
        // Backoff is generous because the failure mode being retried is
        // usually "the exchange throttled us", which a fast retry re-triggers.
        await sleep(1500 * Math.pow(2, attempt));
      }
    }
    throw lastError;
  });
}

/**
 * Short-lived response cache, keyed by URL.
 *
 * Several reports serve more than one provider — MI_MARGN carries both the
 * market-wide credit summary and the per-stock balances, for instance — and a
 * backfill would otherwise re-request the same URL once per consumer at
 * 2.2 seconds a turn. The TTL keeps a long-running scheduler from serving a
 * stale session after the exchange publishes the next one.
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
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}
