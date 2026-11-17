/**
 * Taiwan cash-equity market clock: which days trade, where the session is
 * right now, and which session's after-hours data should already be out.
 *
 * Every function takes plain `YYYY-MM-DD` Taipei calendar dates (not Date
 * objects) so no caller can accidentally roll a date over in the runtime's
 * own timezone. Convert to the UTC-midnight storage key with `sessionKey()`.
 *
 * Holidays come from TWSE 市場開休市日期:
 *   - https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?date=YYYY0101&response=json
 *   - https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule (next year only)
 * The table below MUST be extended every December when TWSE publishes the
 * next year. For a year it does not cover, `isTradingDay` falls back to
 * "every weekday trades" and `calendarCovers()` reports false so the health
 * page can say so instead of silently guessing.
 */

/** Dates on which the market does not trade although they are weekdays or
 *  weekend dates TWSE lists explicitly. Includes the 「市場無交易，僅辦理結算交割作業」
 *  days before Lunar New Year. Weekends need not be listed. */
const CLOSED: Record<number, readonly string[]> = {
  2026: [
    "2026-01-01",
    "2026-02-12",
    "2026-02-13",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-02-19",
    "2026-02-20",
    "2026-02-27",
    "2026-04-03",
    "2026-04-06",
    "2026-05-01",
    "2026-06-19",
    "2026-09-25",
    "2026-09-28",
    "2026-10-09",
    "2026-10-26",
    "2026-12-25",
  ],
  2027: [
    "2027-01-01",
    "2027-02-02",
    "2027-02-03",
    "2027-02-04",
    "2027-02-05",
    "2027-02-08",
    "2027-02-09",
    "2027-02-10",
    "2027-03-01",
    "2027-04-05",
    "2027-04-06",
    "2027-04-30",
    "2027-06-09",
    "2027-09-15",
    "2027-09-28",
    "2027-10-11",
    "2027-10-25",
    "2027-12-24",
    "2027-12-31",
  ],
};
const CLOSED_SET = new Set(Object.values(CLOSED).flat());

/** Regular session, Asia/Taipei. The closing call auction ends at 13:30. */
export const SESSION_OPEN_MIN = 9 * 60;
export const SESSION_CLOSE_MIN = 13 * 60 + 30;

/**
 * When the after-hours whole-market close (FMTQIK, MI_INDEX 每日收盤行情, TPEx
 * daily close) is normally out, in minutes after Taipei midnight. Observed on
 * 2026-11-17: all three carried the session by 16:06. 14:30 is the earliest
 * the pipeline should EXPECT them; a later-publishing report (T86 per-stock
 * institutional flows) has its own, later expectation in the pipeline.
 */
export const CLOSE_PUBLISHED_MIN = 14 * 60 + 30;

export type MarketPhase =
  /** trading day, before 09:00 */
  | "pre-open"
  /** trading day, 09:00–13:30 */
  | "open"
  /** trading day, after 13:30 */
  | "post-close"
  /** weekend or exchange holiday */
  | "closed-day";

export interface TaipeiNow {
  /** Taipei calendar date, YYYY-MM-DD */
  date: string;
  /** minutes after Taipei midnight, 0–1439 */
  minutes: number;
}

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Taipei calendar date and minute-of-day for an instant. */
export function taipeiNow(now: Date = new Date()): TaipeiNow {
  const p = Object.fromEntries(ymd.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD calendar date. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Shift a YYYY-MM-DD calendar date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whether the holiday table covers this year; when false, `isTradingDay` is a weekday-only guess. */
export function calendarCovers(year: number): boolean {
  return year in CLOSED;
}

export function isTradingDay(date: string): boolean {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  return !CLOSED_SET.has(date);
}

/** The newest trading day on or before `date`. */
export function tradingDayOnOrBefore(date: string): string {
  let d = date;
  for (let i = 0; i < 40 && !isTradingDay(d); i++) d = addDays(d, -1);
  return d;
}

/** The trading day before `date` (exclusive). */
export function previousTradingDay(date: string): string {
  return tradingDayOnOrBefore(addDays(date, -1));
}

export function marketPhase(now: Date = new Date()): MarketPhase {
  const t = taipeiNow(now);
  if (!isTradingDay(t.date)) return "closed-day";
  if (t.minutes < SESSION_OPEN_MIN) return "pre-open";
  if (t.minutes < SESSION_CLOSE_MIN) return "open";
  return "post-close";
}

/**
 * The newest session whose after-hours close should be published by `now`:
 * today once it is a trading day past `publishedByMin`, otherwise the
 * previous trading day. Use it to flag stored data as stale — never to
 * decide which session a report actually carries (ask the report).
 */
export function expectedLatestSession(now: Date = new Date(), publishedByMin: number = CLOSE_PUBLISHED_MIN): string {
  const t = taipeiNow(now);
  if (isTradingDay(t.date) && t.minutes >= publishedByMin) return t.date;
  return previousTradingDay(t.date);
}

/** UTC-midnight storage key (see src/lib/dates.ts) for a YYYY-MM-DD session. */
export function sessionKey(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** YYYY-MM-DD for a UTC-midnight storage key. */
export function sessionString(key: Date): string {
  return key.toISOString().slice(0, 10);
}
