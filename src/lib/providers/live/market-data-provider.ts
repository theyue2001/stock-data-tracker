import { fetchJson, fetchJsonOptional } from "@/lib/providers/live/http";
import {
  parseNumber,
  rocCompactToDate,
  rocSlashToDate,
  toTpexDateParam,
  toTwseDateParam,
} from "@/lib/providers/live/parse";
import type { MarketDataProvider, MarketQuote, ProviderSource, StockRef } from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Official daily OHLCV from the two Taiwan exchanges.
 *
 * Two access patterns, because the exchanges publish them differently:
 *
 *  - The daily pull uses the whole-market snapshot endpoints (one request per
 *    exchange covers every tracked stock), which is what the nightly job wants.
 *  - The backfill uses the per-stock monthly reports, since neither exchange
 *    exposes a whole-market snapshot for a *past* date in a single call.
 *
 * Volume is normalized to SHARES throughout. This matters because the two
 * exchanges disagree on the unit: the OpenAPI snapshots and the TWSE per-stock
 * monthly report (成交股數) are already in shares, while the TPEx per-stock
 * monthly report is in 張/lots (x1000 = shares). Mixing them would put a 1000x
 * discontinuity right at the boundary between backfilled and freshly-pulled
 * history, and every volume-expansion reading that straddles that boundary
 * would be garbage.
 */

const TWSE_SNAPSHOT = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_SNAPSHOT = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
const TWSE_MONTH = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";
const TPEX_MONTH = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock";

interface TwseSnapshotRow {
  Date: string;
  Code: string;
  TradeVolume: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  ClosingPrice: string;
  Change: string;
}

interface TpexSnapshotRow {
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
    const wanted = new Set(stocks.map((s) => s.ticker));
    const quotes: MarketQuote[] = [];

    const [twse, tpex] = await Promise.all([
      fetchJsonOptional<TwseSnapshotRow[]>(TWSE_SNAPSHOT),
      fetchJsonOptional<TpexSnapshotRow[]>(TPEX_SNAPSHOT),
    ]);

    for (const row of twse ?? []) {
      if (!wanted.has(row.Code)) continue;
      const date = rocCompactToDate(row.Date);
      const close = parseNumber(row.ClosingPrice);
      if (!date || close === null) continue;
      quotes.push({
        ticker: row.Code,
        date,
        open: parseNumber(row.OpeningPrice) ?? close,
        high: parseNumber(row.HighestPrice) ?? close,
        low: parseNumber(row.LowestPrice) ?? close,
        close,
        volume: parseNumber(row.TradeVolume) ?? 0,
        change: parseNumber(row.Change),
      });
    }

    for (const row of tpex ?? []) {
      const ticker = row.SecuritiesCompanyCode?.trim();
      if (!ticker || !wanted.has(ticker)) continue;
      const date = rocCompactToDate(row.Date);
      const close = parseNumber(row.Close);
      if (!date || close === null) continue;
      quotes.push({
        ticker,
        date,
        open: parseNumber(row.Open) ?? close,
        high: parseNumber(row.High) ?? close,
        low: parseNumber(row.Low) ?? close,
        close,
        // Already shares on this endpoint, unlike the monthly report below.
        volume: parseNumber(row.TradingShares) ?? 0,
        change: parseNumber(row.Change),
      });
    }

    return quotes;
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
