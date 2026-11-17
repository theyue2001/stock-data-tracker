/**
 * Errors a provider throws so the job log can tell "the source has not
 * published yet" and "the request failed with HTTP 4xx/5xx" apart from a
 * generic failure. Throw these instead of returning an empty array or zeros:
 * an empty result is indistinguishable from "nothing happened today".
 */

/** The source answered normally but has not published the requested session
 *  yet (e.g. T86 at 16:00 on the session day). Recorded as `waiting`, not
 *  `failed`, and retried on the next pipeline poll. */
export class NotPublishedError extends Error {
  readonly source: string;
  /** YYYY-MM-DD session that was asked for. */
  readonly session: string;
  constructor(source: string, session: string, message?: string) {
    super(message ?? `${source} has not published ${session} yet`);
    this.name = "NotPublishedError";
    this.source = source;
    this.session = session;
  }
}

/** A non-success HTTP response, carrying the status for the job log. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} from ${url}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.url = url;
  }
}

/** The HTTP status behind an error, if it carries one. */
export function httpStatusOf(err: unknown): number | null {
  if (err instanceof HttpStatusError) return err.status;
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}
