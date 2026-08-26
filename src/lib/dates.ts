/**
 * All date-keyed rows (MarketData, IndicatorValue, IndustryScore,
 * InstitutionalFlow, DailyBrief, MarketStatus) use a UTC midnight boundary as
 * their unique key. Using the runtime's local midnight instead would produce
 * a different key on every machine/timezone and silently duplicate rows, so
 * every writer and reader must go through these helpers.
 */

export function utcDay(d: Date = new Date()): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function utcDayOffset(base: Date, days: number): Date {
  const out = utcDay(base);
  out.setUTCDate(out.getUTCDate() - days);
  return out;
}

/**
 * "Today" as Asia/Taipei sees it, as the same UTC-midnight key every
 * date-keyed row uses.
 *
 * Every provider in this codebase publishes on the Taiwan trading calendar, so
 * "has today's session landed yet" has to ask what day it is THERE — a job
 * runner in another timezone (a US-region Vercel function, a CI box) would
 * otherwise roll the date over up to 16 hours off from the market it is
 * asking about.
 */
export function taipeiToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const [year, month, day] = parts.split("-").map(Number);
  return utcDay(new Date(Date.UTC(year, month - 1, day)));
}

/** Formats as YYYY-MM-DD from the UTC parts, matching the storage key. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns the newest available session date from a set of member readings. */
export function latestSessionDate(dates: Iterable<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
  }
  return latest;
}

/**
 * Whether a dated row actually describes the session being scored.
 *
 * Lives here rather than in either scoring job because BOTH must answer it the
 * same way. The heat score used to compare a flow row against the `asOf` it was
 * called with, while the sentiment job compared it against the session the
 * member PRICE bars describe. Those diverge whenever prices are staler than the
 * requested date — the T86 flow report and the price snapshot arrive from
 * different endpoints on different lags — and the two screens then disagreed
 * about whether the same industry had flow data for the same day.
 *
 * `sessionDate` is therefore always the price-derived session: the question is
 * "does this flow row describe the same session as the prices we are scoring",
 * not "does it match the date someone asked for".
 */
export function flowIsCurrent(flowDate: Date | null | undefined, sessionDate: Date | null | undefined): boolean {
  if (!flowDate || !sessionDate) return false;
  return utcDateKey(flowDate) === utcDateKey(sessionDate);
}
