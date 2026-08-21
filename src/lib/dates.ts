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

/** Formats as YYYY-MM-DD from the UTC parts, matching the storage key. */
export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
