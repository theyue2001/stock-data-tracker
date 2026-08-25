import { fetchJsonOptional } from "@/lib/providers/live/http";
import { parseNumber, rocCompactToDate, toTpexDateParam, toTwseDateParam } from "@/lib/providers/live/parse";
import type {
  InstitutionalFlowProvider,
  InstitutionalFlowResult,
  ProviderSource,
  StockRef,
} from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Official per-stock institutional trading (三大法人買賣超) and margin
 * financing balances, from TWSE T86 / MI_MARGN and the TPEx equivalents.
 *
 * Only STOCK-scope rows are produced here. Industry flow is the sum of its
 * member stocks and is aggregated by the refresh job, which knows the
 * taxonomy; market flow comes from the market-status provider, which already
 * fetches the market-wide report. Deriving the industry figure from the same
 * per-stock rows the UI drills into is what keeps an industry card and the
 * stock list underneath it from disagreeing.
 *
 * The three net figures are reported in SHARES (see
 * InstitutionalFlowResult.unit) — that is the only unit either exchange
 * publishes at stock level. The margin balance change is not a share count
 * and is left in 張, the unit both feeds publish it in: neither exchange
 * publishes a per-stock loan AMOUNT, so there is nothing here the writer
 * could store in its NT$ margin column, and it stores none.
 */

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TPEX_INSTI = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade";
const TPEX_MARGIN = "https://www.tpex.org.tw/www/zh-tw/margin/balance";
const TWSE_SNAPSHOT_DATE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";

interface TwseTableResponse {
  stat?: string;
  date?: string;
  fields?: string[];
  data?: string[][];
  tables?: Array<{ title?: string; fields?: string[]; data?: string[][] }>;
}

interface TpexTableResponse {
  date?: string;
  tables?: Array<{ date?: string; fields?: string[]; data?: string[][] }>;
}

/** Per-stock net flows in shares, plus the margin-balance change in 張. */
interface StockFlowRow {
  foreignNetShares: number;
  trustNetShares: number;
  dealerNetShares: number;
  marginChangeLots: number;
}

export class TwseInstitutionalFlowProvider implements InstitutionalFlowProvider {
  readonly source: ProviderSource = {
    key: "twse-tpex-institutional",
    name: "TWSE / TPEx Institutional Trading & Margin",
    category: "institutional_flow",
    url: "https://www.twse.com.tw/zh/trading/foreign/t86.html",
    isMock: false,
    description:
      "Official daily foreign / investment-trust / dealer net buying per stock, and the margin financing balance change, from the TWSE and TPEx after-hours reports.",
  };

  async fetchLatest(stocks: StockRef[]): Promise<InstitutionalFlowResult[]> {
    const date = await this.latestSessionDate();
    if (!date) return [];
    return this.fetchForDate(stocks, date);
  }

  async fetchForDate(stocks: StockRef[], date: Date): Promise<InstitutionalFlowResult[]> {
    const day = utcDay(date);
    const wanted = new Map(stocks.map((s) => [s.ticker, s.exchange] as const));

    // Both exchanges are hit concurrently; the HTTP layer throttles each host
    // independently so this does not risk a rate-limit block.
    const [twseFlows, twseMargin, tpexFlows, tpexMargin] = await Promise.all([
      this.fetchTwseFlows(day),
      this.fetchTwseMargin(day),
      this.fetchTpexFlows(day),
      this.fetchTpexMargin(day),
    ]);

    const merged = new Map<string, StockFlowRow>();
    const absorb = (
      flows: Map<string, Omit<StockFlowRow, "marginChangeLots">>,
      margin: Map<string, number>,
    ) => {
      for (const [ticker, flow] of flows) {
        merged.set(ticker, { ...flow, marginChangeLots: margin.get(ticker) ?? 0 });
      }
      // A stock can have a margin change on a session with no institutional
      // activity at all, and dropping it would understate leverage build-up.
      for (const [ticker, lots] of margin) {
        if (merged.has(ticker)) continue;
        merged.set(ticker, {
          foreignNetShares: 0,
          trustNetShares: 0,
          dealerNetShares: 0,
          marginChangeLots: lots,
        });
      }
    };
    absorb(twseFlows, twseMargin);
    absorb(tpexFlows, tpexMargin);

    const results: InstitutionalFlowResult[] = [];
    for (const [ticker, row] of merged) {
      if (!wanted.has(ticker)) continue;
      results.push({
        date: day,
        scope: "stock",
        ticker,
        foreignNet: row.foreignNetShares,
        trustNet: row.trustNetShares,
        dealerNet: row.dealerNetShares,
        // Left in 張, deliberately not converted to shares. Valuing it at the
        // close the way the three net figures are valued would yield the
        // market value of the shares under margin, not the change in the loan
        // behind them: the loan is struck at ~60% of the price on the day it
        // is taken out and never marks to market, so 張 x close comes out
        // anywhere from 0.4x to 2.6x the exchange's own 融資金額 delta, and on
        // a session where cheap names gained margin while expensive ones shed
        // it, with the opposite sign.
        marginChange: row.marginChangeLots,
        turnover: 0, // derived from stored price data by the refresh job
        volumeChangePct: 0, // ditto
        unit: "shares",
      });
    }
    return results;
  }

  /** The date of the most recently published whole-market snapshot. Using the
   *  wall clock instead would ask for a report that does not exist yet on a
   *  weekend, a holiday, or before the after-hours publication. */
  private async latestSessionDate(): Promise<Date | null> {
    const rows = await fetchJsonOptional<Array<{ Date?: string }>>(TWSE_SNAPSHOT_DATE);
    const stamp = rows?.[0]?.Date;
    return stamp ? rocCompactToDate(stamp) : null;
  }

  private async fetchTwseFlows(
    day: Date,
  ): Promise<Map<string, Omit<StockFlowRow, "marginChangeLots">>> {
    const url = `${TWSE_T86}?date=${toTwseDateParam(day)}&selectType=ALL&response=json`;
    const payload = await fetchJsonOptional<TwseTableResponse>(url);
    const out = new Map<string, Omit<StockFlowRow, "marginChangeLots">>();
    if (payload?.stat !== "OK" || !payload.data) return out;

    // 0 代號 … 4 外陸資買賣超(不含外資自營商), 7 外資自營商買賣超,
    // 10 投信買賣超, 11 自營商買賣超(合計)
    for (const row of payload.data) {
      const ticker = String(row[0] ?? "").trim();
      if (!ticker) continue;
      // Foreign totals include the foreign-dealer book so the figure matches
      // what TPEx reports as 外資及陸資合計 on the other exchange.
      const foreign = (parseNumber(row[4]) ?? 0) + (parseNumber(row[7]) ?? 0);
      out.set(ticker, {
        foreignNetShares: foreign,
        trustNetShares: parseNumber(row[10]) ?? 0,
        dealerNetShares: parseNumber(row[11]) ?? 0,
      });
    }
    return out;
  }

  /** Per-stock change in the margin financing balance, in 張. */
  private async fetchTwseMargin(day: Date): Promise<Map<string, number>> {
    const url = `${TWSE_MARGIN}?date=${toTwseDateParam(day)}&selectType=ALL&response=json`;
    const payload = await fetchJsonOptional<TwseTableResponse>(url);
    const out = new Map<string, number>();
    const table = payload?.tables?.find((t) => (t.fields?.length ?? 0) > 10 && t.data?.length);
    if (!table?.data) return out;

    // 0 代號, 1 名稱, 2 資買, 3 資賣, 4 現償, 5 前日餘額, 6 今日餘額 (張)
    for (const row of table.data) {
      const ticker = String(row[0] ?? "").trim();
      const prior = parseNumber(row[5]);
      const today = parseNumber(row[6]);
      if (!ticker || prior === null || today === null) continue;
      out.set(ticker, today - prior);
    }
    return out;
  }

  private async fetchTpexFlows(
    day: Date,
  ): Promise<Map<string, Omit<StockFlowRow, "marginChangeLots">>> {
    const url = `${TPEX_INSTI}?type=Daily&sect=EW&date=${toTpexDateParam(day)}&id=&response=json`;
    const payload = await fetchJsonOptional<TpexTableResponse>(url);
    const rows = payload?.tables?.[0]?.data;
    const out = new Map<string, Omit<StockFlowRow, "marginChangeLots">>();
    if (!rows) return out;

    // 0 代號, 1 名稱, then buy/sell/net triplets:
    // 2-4 外資不含自營, 5-7 外資自營商, 8-10 外資合計,
    // 11-13 投信, 14-16 自營自行, 17-19 自營避險, 20-22 自營合計, 23 三大法人合計
    for (const row of rows) {
      const ticker = String(row[0] ?? "").trim();
      if (!ticker) continue;
      out.set(ticker, {
        foreignNetShares: parseNumber(row[10]) ?? 0,
        trustNetShares: parseNumber(row[13]) ?? 0,
        dealerNetShares: parseNumber(row[22]) ?? 0,
      });
    }
    return out;
  }

  private async fetchTpexMargin(day: Date): Promise<Map<string, number>> {
    const url = `${TPEX_MARGIN}?date=${toTpexDateParam(day)}&id=&response=json`;
    const payload = await fetchJsonOptional<TpexTableResponse>(url);
    const rows = payload?.tables?.[0]?.data;
    const out = new Map<string, number>();
    if (!rows) return out;

    // 0 代號, 1 名稱, 2 前資餘額(張), 3 資買, 4 資賣, 5 現償, 6 資餘額(張)
    for (const row of rows) {
      const ticker = String(row[0] ?? "").trim();
      const prior = parseNumber(row[2]);
      const today = parseNumber(row[6]);
      if (!ticker || prior === null || today === null) continue;
      out.set(ticker, today - prior);
    }
    return out;
  }
}
