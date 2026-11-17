import { fetchJson, fetchJsonOptional } from "@/lib/providers/live/http";
import {
  cellText,
  dayString,
  fieldIndex,
  parseNumber,
  rocCompactToDate,
  rocSlashToDate,
  rocTitleToDate,
  sameDay,
  toTpexDateParam,
  toTwseDateParam,
  twseHasNoData,
} from "@/lib/providers/live/parse";
import { requirePublishedSession, type TwseTableResponse } from "@/lib/providers/live/market-status-provider";
import { NotPublishedError } from "@/lib/providers/errors";
import type { MarketDataProvider, MarketQuote, ProviderSource, StockRef } from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Official daily OHLCV from the two Taiwan exchanges.
 *
 * Two access patterns, because the exchanges publish them differently:
 *
 *  - The daily pull uses whole-market reports (one request per exchange
 *    covers every tracked stock), which is what the nightly job wants.
 *  - The backfill uses the per-stock monthly reports (see fetchStockMonth).
 *
 * The daily pull is pinned to ONE session — the one `latestSessionDate()`
 * resolves — and returns nothing from any other. The free openapi mirrors
 * lag differently (TWSE's STOCK_DAY_ALL is regenerated at ~05:20 the next
 * morning, TPEx's close at ~16:00 on the session day), so trusting each one's
 * own date would store session D for one exchange beside D-1 for the other.
 *
 * Volume is normalized to SHARES throughout. This matters because the two
 * exchanges disagree on the unit: the OpenAPI snapshots, MI_INDEX 每日收盤行情
 * and the TWSE per-stock monthly report (成交股數) are already in shares, while
 * the TPEx per-stock monthly report is in 張/lots (x1000 = shares). Mixing them
 * would put a 1000x discontinuity right at the boundary between backfilled and
 * freshly-pulled history, and every volume-expansion reading that straddles
 * that boundary would be garbage.
 */

const TWSE_SNAPSHOT = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TWSE_DAILY_CLOSE = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";
const TPEX_SNAPSHOT = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
const TWSE_MONTH = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";
const TPEX_MONTH = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock";

export interface TwseSnapshotRow {
  Date: string;
  Code: string;
  TradeVolume: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  ClosingPrice: string;
  Change: string;
}

export interface TpexSnapshotRow {
  Date: string;
  SecuritiesCompanyCode: string;
  Open: string;
  High: string;
  Low: string;
  Close: string;
  Change: string;
  TradingShares: string;
}

interface TwseMonthResponse {
  stat: string;
  data?: string[][];
}

interface TpexMonthResponse {
  tables?: Array<{ data?: string[][] }>;
}

export class TwseMarketDataProvider implements MarketDataProvider {
  readonly source: ProviderSource = {
    key: "twse-tpex-prices",
    name: "TWSE / TPEx Daily Trading",
    category: "market_data",
    url: "https://openapi.twse.com.tw/",
    isMock: false,
    description:
      "Official daily open/high/low/close/volume from the Taiwan Stock Exchange and Taipei Exchange after-hours reports.",
  };

  async fetchLatest(stocks: StockRef[]): Promise<MarketQuote[]> {
    const { date } = await requirePublishedSession();
    return this.fetchSession(stocks, date);
  }

  /**
   * Every tracked stock's close for `session` from both exchanges, and nothing
   * from any other session.
   *
   * An exchange that has not published `session` yet contributes no rows —
   * the caller sees the shortfall by count — and only when NEITHER has does
   * this throw NotPublishedError, since an empty array would read as "nothing
   * traded".
   */
  async fetchSession(stocks: StockRef[], session: Date): Promise<MarketQuote[]> {
    const wanted = new Set(stocks.map((s) => s.ticker));
    const [twse, tpex] = await Promise.all([this.fetchTwseSession(wanted, session), this.fetchTpexSession(wanted, session)]);

    const day = dayString(session);
    if (!twse && !tpex) {
      throw new NotPublishedError(this.source.key, day, `Neither TWSE nor TPEx serves the ${day} close yet`);
    }
    if (!twse) console.warn(`[prices] TWSE does not serve the ${day} close yet; listed stocks are absent this run`);
    if (!tpex) console.warn(`[prices] the TPEx close snapshot does not carry ${day}; OTC stocks are absent this run`);
    return [...(twse ?? []), ...(tpex ?? [])];
  }

  /**
   * Listed closes for `session`, or null when TWSE has not published it.
   *
   * The openapi mirror is tried first because it is free and never throttled,
   * and from ~05:20 the next morning it does carry `session`. On the evening
   * of the session day it still carries the previous one, so MI_INDEX
   * 每日收盤行情 — one request for every listed stock — is asked instead.
   */
  private async fetchTwseSession(wanted: Set<string>, session: Date): Promise<MarketQuote[] | null> {
    const mirror = await fetchJsonOptional<TwseSnapshotRow[]>(TWSE_SNAPSHOT).catch((error: Error) => {
      console.warn(`[prices] openapi STOCK_DAY_ALL unavailable (${error.message}); asking MI_INDEX`);
      return null;
    });
    const fromMirror = twseSnapshotQuotes(mirror ?? [], wanted, session);
    if (fromMirror) return fromMirror;

    const payload = await fetchJson<TwseTableResponse>(
      `${TWSE_DAILY_CLOSE}?date=${toTwseDateParam(session)}&type=ALLBUT0999&response=json`,
    );
    return miIndexQuotes(payload, wanted, session);
  }

  /** OTC closes for `session`, or null when the TPEx snapshot carries another session. */
  private async fetchTpexSession(wanted: Set<string>, session: Date): Promise<MarketQuote[] | null> {
    const rows = await fetchJsonOptional<TpexSnapshotRow[]>(TPEX_SNAPSHOT);
    return tpexSnapshotQuotes(rows ?? [], wanted, session);
  }

  async fetchRange(stocks: StockRef[], from: Date, to: Date): Promise<MarketQuote[]> {
    const months = monthStarts(from, to);

    // TWSE and TPEx are throttled independently by the HTTP layer, so running
    // the two exchanges concurrently roughly halves the backfill wall clock.
    const twseStocks = stocks.filter((s) => s.exchange !== "TPEx");
    const tpexStocks = stocks.filter((s) => s.exchange === "TPEx");

    const [twseResults, tpexResults] = await Promise.all([
      fetchExchangeRange(twseStocks, months, (s, m) => this.fetchTwseMonth(s.ticker, m), "prices/twse"),
      fetchExchangeRange(tpexStocks, months, (s, m) => this.fetchTpexMonth(s.ticker, m), "prices/tpex"),
    ]);

    const fromDay = utcDay(from).getTime();
    const toDay = utcDay(to).getTime();
    return [...twseResults, ...tpexResults].filter(
      (q) => q.date.getTime() >= fromDay && q.date.getTime() <= toDay,
    );
  }

  /**
   * One stock, one calendar month — the smallest unit the historical reports
   * expose, and therefore the unit a resumable backfill has to work in. Public
   * so the backfill can drive the loop itself: it needs to skip stock-months
   * already stored and to persist each result as it arrives, because the source
   * will usually block before the whole range is covered.
   */
  async fetchStockMonth(stock: StockRef, month: Date): Promise<MarketQuote[]> {
    return stock.exchange === "TPEx"
      ? this.fetchTpexMonth(stock.ticker, month)
      : this.fetchTwseMonth(stock.ticker, month);
  }

  private async fetchTwseMonth(ticker: string, month: Date): Promise<MarketQuote[]> {
    const url = `${TWSE_MONTH}?date=${toTwseDateParam(month)}&stockNo=${ticker}&response=json`;
    const payload = await fetchJsonOptional<TwseMonthResponse>(url);
    if (!payload || payload.stat !== "OK" || !payload.data) return [];

    // 日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數
    return payload.data.flatMap((row) => {
      const date = rocSlashToDate(row[0] ?? "");
      const close = parseNumber(row[6]);
      if (!date || close === null) return [];
      return [
        {
          ticker,
          date,
          open: parseNumber(row[3]) ?? close,
          high: parseNumber(row[4]) ?? close,
          low: parseNumber(row[5]) ?? close,
          close,
          volume: parseNumber(row[1]) ?? 0, // already shares
          change: parseNumber(row[7]),
        },
      ];
    });
  }

  private async fetchTpexMonth(ticker: string, month: Date): Promise<MarketQuote[]> {
    const url = `${TPEX_MONTH}?code=${ticker}&date=${toTpexDateParam(month)}&id=&response=json`;
    const payload = await fetchJsonOptional<TpexMonthResponse>(url);
    const rows = payload?.tables?.[0]?.data;
    if (!rows) return [];

    // 日期, 成交張數, 成交仟元, 開盤, 最高, 最低, 收盤, 漲跌, 筆數
    return rows.flatMap((row) => {
      const date = rocSlashToDate(row[0] ?? "");
      const close = parseNumber(row[6]);
      if (!date || close === null) return [];
      const lots = parseNumber(row[1]) ?? 0;
      return [
        {
          ticker,
          date,
          open: parseNumber(row[3]) ?? close,
          high: parseNumber(row[4]) ?? close,
          low: parseNumber(row[5]) ?? close,
          close,
          // 成交張數 -> shares, matching the snapshot endpoint unit.
          volume: lots * 1000,
          change: parseNumber(row[7]),
        },
      ];
    });
  }
}

async function fetchExchangeRange(
  stocks: StockRef[],
  months: Date[],
  fetchMonth: (stock: StockRef, month: Date) => Promise<MarketQuote[]>,
  label = "prices",
): Promise<MarketQuote[]> {
  const out: MarketQuote[] = [];
  const total = stocks.length * months.length;
  const announce = total > 5;
  let done = 0;

  for (const stock of stocks) {
    for (const month of months) {
      try {
        out.push(...(await fetchMonth(stock, month)));
      } catch (error) {
        // A single missing month (pre-listing, or a report the exchange never
        // published) must not abort a backfill spanning 55 stocks.
        console.warn(
          `[${label}] ${stock.ticker} ${month.toISOString().slice(0, 7)} skipped: ${(error as Error).message}`,
        );
      }
      done++;
      // One throttled request per stock-month, so a full window is hundreds of
      // sequential requests. Without progress it reads as a hang.
      if (announce && (done % 25 === 0 || done === total)) {
        console.log(`[${label}] ${done}/${total} stock-months, ${out.length} sessions`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Whole-market report parsers. Pure, so the session decisions are testable
// against saved responses (see __fixtures__).
// ---------------------------------------------------------------------------

/**
 * One quote, or null for a row that did not trade.
 *
 * A missing close ("--") or volume means no trade this session and the row is
 * dropped, never zero-filled. A missing open/high/low on a row that DID trade
 * falls back to the close, as the monthly parsers in this file always have;
 * neither whole-market report has been seen to do that for a traded row.
 */
function toQuote(
  ticker: string,
  date: Date,
  cells: { open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown },
  change: number | null,
): MarketQuote | null {
  const close = parseNumber(cells.close);
  const volume = parseNumber(cells.volume);
  if (close === null || volume === null) return null;
  return {
    ticker,
    date,
    open: parseNumber(cells.open) ?? close,
    high: parseNumber(cells.high) ?? close,
    low: parseNumber(cells.low) ?? close,
    close,
    volume,
    change,
  };
}

/**
 * Quotes from the openapi STOCK_DAY_ALL mirror, or null when the mirror does
 * not carry `session` (it lags the session day until ~05:20 the next morning).
 */
export function twseSnapshotQuotes(rows: TwseSnapshotRow[], wanted: Set<string>, session: Date): MarketQuote[] | null {
  const day = utcDay(session);
  const forSession = rows.filter((row) => {
    const date = rocCompactToDate(row.Date ?? "");
    return !!date && sameDay(date, day);
  });
  if (!forSession.length) return null;

  const out: MarketQuote[] = [];
  for (const row of forSession) {
    const ticker = row.Code?.trim();
    if (!ticker || !wanted.has(ticker)) continue;
    const quote = toQuote(
      ticker,
      day,
      { open: row.OpeningPrice, high: row.HighestPrice, low: row.LowestPrice, close: row.ClosingPrice, volume: row.TradeVolume },
      parseNumber(row.Change),
    );
    if (quote) out.push(quote);
  }
  return out;
}

/**
 * Quotes from MI_INDEX type=ALLBUT0999 (每日收盤行情), or null when TWSE has
 * not published `session`.
 *
 * The table is located by its title and its columns by name: the payload
 * holds ten tables (six of them index-level tables), so
 * a hard-coded position would read index levels as stock prices the day TWSE
 * inserts or reorders one.
 * Its own title date is checked against `session`, because the top-level
 * `date` field merely echoes the request.
 *
 * 漲跌價差 is unsigned; the sign lives in an HTML cell (`<p style= color:
 * green>-</p>`). "X" (不比價: ex-rights/ex-dividend, new listing, resumption)
 * and a blank sign carry 0.00 and are stored as 0 — the value the openapi
 * mirror itself reports for the same rows (checked row for row on 11-16) — and
 * a non-zero difference without a sign is left null for the writer to derive.
 */
export function miIndexQuotes(payload: TwseTableResponse, wanted: Set<string>, session: Date): MarketQuote[] | null {
  if (twseHasNoData(payload)) return null;
  if (payload.stat !== "OK") throw new Error(`MI_INDEX ALLBUT0999 answered "${payload.stat}"`);
  const table = payload.tables?.find((t) => t?.title?.includes("每日收盤行情"));
  if (!table?.data?.length) return null;

  const day = utcDay(session);
  const carried = rocTitleToDate(table.title ?? "");
  if (!carried) throw new Error(`MI_INDEX 每日收盤行情 title carries no date: "${table.title}"`);
  if (!sameDay(carried, day)) {
    if (carried.getTime() < day.getTime()) return null;
    throw new Error(`MI_INDEX asked for ${dayString(day)} answered ${dayString(carried)}`);
  }

  const col = (name: string) => fieldIndex("MI_INDEX 每日收盤行情", table.fields, name);
  const code = col("證券代號");
  const volume = col("成交股數");
  const open = col("開盤價");
  const high = col("最高價");
  const low = col("最低價");
  const close = col("收盤價");
  const sign = col("漲跌(+/-)");
  const diff = col("漲跌價差");

  const out: MarketQuote[] = [];
  for (const row of table.data) {
    const ticker = String(row[code] ?? "").trim();
    if (!wanted.has(ticker)) continue;
    const quote = toQuote(
      ticker,
      day,
      { open: row[open], high: row[high], low: row[low], close: row[close], volume: row[volume] },
      signedChange(parseNumber(row[diff]), cellText(row[sign])),
    );
    if (quote) out.push(quote);
  }
  return out;
}

/** Signed change from MI_INDEX's unsigned 漲跌價差 and its sign cell text. */
function signedChange(magnitude: number | null, direction: string): number | null {
  if (magnitude === null) return null;
  if (direction === "-") return -magnitude;
  if (direction === "+" || magnitude === 0) return magnitude;
  return null;
}

/**
 * Quotes from the TPEx daily close snapshot, or null when it does not carry
 * `session` — whether it is still on the previous session (before its ~16:00
 * regeneration) or already ahead of a session resolved from the lagging mirror.
 */
export function tpexSnapshotQuotes(rows: TpexSnapshotRow[], wanted: Set<string>, session: Date): MarketQuote[] | null {
  const day = utcDay(session);
  const forSession = rows.filter((row) => {
    const date = rocCompactToDate(row.Date ?? "");
    return !!date && sameDay(date, day);
  });
  if (!forSession.length) return null;

  const out: MarketQuote[] = [];
  for (const row of forSession) {
    const ticker = row.SecuritiesCompanyCode?.trim();
    if (!ticker || !wanted.has(ticker)) continue;
    const quote = toQuote(
      ticker,
      day,
      // Already shares on this endpoint, unlike the monthly report above.
      { open: row.Open, high: row.High, low: row.Low, close: row.Close, volume: row.TradingShares },
      parseNumber(row.Change),
    );
    if (quote) out.push(quote);
  }
  return out;
}

/** Every month boundary touched by [from, to], oldest first. */
function monthStarts(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Resolves which exchange each ticker actually trades on, from the two live
 * snapshots. Seed data cannot be trusted for this — listings move between
 * boards and companies get merged away, and a wrong exchange means every
 * request for that stock silently returns nothing.
 */
export async function resolveExchanges(tickers: string[]): Promise<Map<string, "TWSE" | "TPEx" | null>> {
  const [twse, tpex] = await Promise.all([
    fetchJson<TwseSnapshotRow[]>(TWSE_SNAPSHOT),
    fetchJson<TpexSnapshotRow[]>(TPEX_SNAPSHOT),
  ]);
  const twseCodes = new Set(twse.map((r) => r.Code?.trim()));
  const tpexCodes = new Set(tpex.map((r) => r.SecuritiesCompanyCode?.trim()));

  return new Map(tickers.map((t) => [t, twseCodes.has(t) ? "TWSE" : tpexCodes.has(t) ? "TPEx" : null] as const));
}
