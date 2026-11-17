import { fetchJson } from "@/lib/providers/live/http";
import {
  dayString,
  fieldIndex,
  parseNumber,
  rocSlashToDate,
  rocTitleToDate,
  sameDay,
  toTpexDateParam,
  toTwseDateParam,
  twseHasNoData,
  twseTitleDate,
} from "@/lib/providers/live/parse";
import { requirePublishedSession, type TwseTableResponse } from "@/lib/providers/live/market-status-provider";
import { NotPublishedError } from "@/lib/providers/errors";
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
 *
 * All four reports must be published for the session before any row is
 * returned. They publish at different times on the session day (on
 * 2026-11-17 T86 was still empty at 16:07 and out at 16:36, when the TPEx
 * 三大法人 report was out too and both margin reports were still empty), and
 * a report that is not out yet answers with an empty table —
 * which the previous version read as "every stock had zero activity" and
 * stored as measured zeros. Until all four are out this throws
 * NotPublishedError, which the job log records as `waiting`.
 */

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TPEX_INSTI = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade";
const TPEX_MARGIN = "https://www.tpex.org.tw/www/zh-tw/margin/balance";

export interface TpexTableResponse {
  date?: string;
  stat?: string;
  tables?: Array<{ title?: string; date?: string; totalCount?: number; fields?: string[]; data?: string[][] }>;
}

/** Per-stock net flows in shares. */
export interface NetFlows {
  foreignNetShares: number;
  trustNetShares: number;
  dealerNetShares: number;
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

  /** The session prices resolve too (see latestSessionDate), so the flows
   *  written by a run are always valued against that run's own closes. */
  async fetchLatest(stocks: StockRef[]): Promise<InstitutionalFlowResult[]> {
    const { date } = await requirePublishedSession();
    return this.fetchForDate(stocks, date);
  }

  /**
   * Flows and margin change for one session.
   *
   * The two institutional reports (T86, TPEx 三大法人) are required: throws
   * NotPublishedError naming each one not out for `date` yet, and any other
   * failure (HTTP, a block, a layout change) propagates as is.
   *
   * The two per-stock margin reports are best-effort. They publish hours
   * after the institutional ones (MI_MARGN was still out at 16:51 on
   * 2026-11-17, when T86 and TPEx had been up since ~16:30), and the per-stock
   * figure is never stored (persist.ts writes stock-scope margin as 0 by
   * design), so waiting for them would only hold the session's flows — and
   * the scores built on them — back until late evening. A margin report that
   * is not available leaves `marginChange` null.
   */
  async fetchForDate(stocks: StockRef[], date: Date): Promise<InstitutionalFlowResult[]> {
    const day = utcDay(date);

    // Both exchanges are hit concurrently; the HTTP layer throttles each host
    // independently so this does not risk a rate-limit block. allSettled, not
    // all: when several reports are missing the error should name all of
    // them, not whichever lost the race.
    const settled = await Promise.allSettled([
      fetchJson<TwseTableResponse>(`${TWSE_T86}?date=${toTwseDateParam(day)}&selectType=ALL&response=json`).then((p) =>
        parseT86(p, day),
      ),
      fetchJson<TwseTableResponse>(`${TWSE_MARGIN}?date=${toTwseDateParam(day)}&selectType=ALL&response=json`).then(
        (p) => parseTwseMargin(p, day),
      ),
      fetchJson<TpexTableResponse>(
        `${TPEX_INSTI}?type=Daily&sect=EW&date=${toTpexDateParam(day)}&id=&response=json`,
      ).then((p) => parseTpexFlows(p, day)),
      fetchJson<TpexTableResponse>(`${TPEX_MARGIN}?date=${toTpexDateParam(day)}&id=&response=json`).then((p) =>
        parseTpexMargin(p, day),
      ),
    ]);

    const [twseFlowsResult, twseMarginResult, tpexFlowsResult, tpexMarginResult] = settled;
    const required = [twseFlowsResult, tpexFlowsResult];

    const failure = required.find(
      (s): s is PromiseRejectedResult => s.status === "rejected" && !(s.reason instanceof NotPublishedError),
    );
    if (failure) throw failure.reason;
    const waiting = required
      .filter((s): s is PromiseRejectedResult => s.status === "rejected")
      .map((s) => s.reason as NotPublishedError);
    if (waiting.length) {
      throw new NotPublishedError(
        waiting.map((e) => e.source).join(" + "),
        dayString(day),
        waiting.map((e) => e.message).join("; "),
      );
    }

    const twseFlows = (twseFlowsResult as PromiseFulfilledResult<Map<string, NetFlows>>).value;
    const tpexFlows = (tpexFlowsResult as PromiseFulfilledResult<Map<string, NetFlows>>).value;
    const twseMargin = optionalMargin("MI_MARGN", twseMarginResult as PromiseSettledResult<Map<string, number>>);
    const tpexMargin = optionalMargin("TPEx margin", tpexMarginResult as PromiseSettledResult<Map<string, number>>);

    return mergeFlows(stocks, day, [twseFlows, tpexFlows], [twseMargin, tpexMargin]);
  }
}

/** A margin report's rows, or null (logged) when it is not out yet or failed. */
function optionalMargin(report: string, result: PromiseSettledResult<Map<string, number>>): Map<string, number> | null {
  if (result.status === "fulfilled") return result.value;
  const reason = result.reason as unknown;
  const message = reason instanceof Error ? reason.message : String(reason);
  if (reason instanceof NotPublishedError) {
    console.info(`[flows] ${report} not published yet; per-stock margin left null (${message})`);
  } else {
    console.warn(`[flows] ${report} unavailable; per-stock margin left null: ${message}`);
  }
  return null;
}

/**
 * Joins published flow and margin reports into per-stock rows.
 *
 * Absence from a PUBLISHED report is a real zero, which is the only reason
 * the zeros below are not invented: T86 / the TPEx report list just the
 * securities institutions traded that session, and the margin reports list
 * every margin-eligible security, so a stock missing from one had no such
 * activity. That inference is only sound because every report reaching this
 * function has already been confirmed published for `day`.
 *
 * A margin report passed as null was not available, so absence from the
 * margin side proves nothing: a stock found in no published margin report
 * gets `marginChange: null` instead of 0 while any margin report is missing.
 */
export function mergeFlows(
  stocks: StockRef[],
  day: Date,
  flowReports: Array<Map<string, NetFlows>>,
  marginReports: Array<Map<string, number> | null>,
): InstitutionalFlowResult[] {
  const flows = new Map<string, NetFlows>();
  for (const report of flowReports) for (const [ticker, flow] of report) flows.set(ticker, flow);
  const margin = new Map<string, number>();
  for (const report of marginReports) if (report) for (const [ticker, lots] of report) margin.set(ticker, lots);
  const marginComplete = marginReports.every((report) => report !== null);

  const none: NetFlows = { foreignNetShares: 0, trustNetShares: 0, dealerNetShares: 0 };
  const results: InstitutionalFlowResult[] = [];
  for (const { ticker } of stocks) {
    const flow = flows.get(ticker);
    const lots = margin.get(ticker);
    // In neither report: not traded on either exchange this session, or not
    // listed at all. Nothing to say about it.
    if (!flow && lots === undefined) continue;
    const row = flow ?? none;
    results.push({
      date: utcDay(day),
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
      marginChange: lots ?? (marginComplete ? 0 : null),
      turnover: 0, // derived from stored price data by the refresh job
      volumeChangePct: 0, // ditto
      unit: "shares",
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Report parsers. Each one either returns the rows of a report confirmed to be
// published for `day`, or throws: NotPublishedError when the report is empty
// or still on an earlier session, a plain Error when its shape is wrong.
// ---------------------------------------------------------------------------

/** Rejects a report that carries a session other than `day`. One that is still
 *  on an EARLIER session simply has not published `day` yet. */
function requireSession(report: string, carried: Date | null, day: Date): void {
  if (!carried) throw new Error(`${report} payload carries no session date`);
  if (sameDay(carried, day)) return;
  if (carried.getTime() < day.getTime()) {
    throw new NotPublishedError(report, dayString(day), `${report} still carries ${dayString(carried)}, not ${dayString(day)}`);
  }
  throw new Error(`${report} asked for ${dayString(day)} answered ${dayString(carried)}`);
}

/** Collects one row per ticker; a row with an unreadable cell is dropped and
 *  counted rather than read as zero. */
function collect<T>(report: string, rows: string[][], read: (row: string[]) => [string, T] | null): Map<string, T> {
  const out = new Map<string, T>();
  let unreadable = 0;
  for (const row of rows) {
    const entry = read(row);
    if (entry) out.set(entry[0], entry[1]);
    else unreadable++;
  }
  if (unreadable) console.warn(`[flows] ${report}: ${unreadable} row(s) with unreadable figures skipped`);
  return out;
}

/** TWSE T86 三大法人買賣超日報, per stock, in shares. */
export function parseT86(payload: TwseTableResponse, day: Date): Map<string, NetFlows> {
  const report = "TWSE T86";
  if (twseHasNoData(payload)) throw new NotPublishedError(report, dayString(day));
  if (payload.stat !== "OK") throw new Error(`${report} answered "${payload.stat}"`);
  requireSession(report, twseTitleDate(payload), day);
  if (!payload.data?.length) throw new NotPublishedError(report, dayString(day));

  const code = fieldIndex(report, payload.fields, "證券代號");
  const foreign = fieldIndex(report, payload.fields, "外陸資買賣超股數(不含外資自營商)");
  const foreignDealer = fieldIndex(report, payload.fields, "外資自營商買賣超股數");
  const trust = fieldIndex(report, payload.fields, "投信買賣超股數");
  const dealer = fieldIndex(report, payload.fields, "自營商買賣超股數");

  return collect(report, payload.data, (row) => {
    const ticker = String(row[code] ?? "").trim();
    const f = parseNumber(row[foreign]);
    const fd = parseNumber(row[foreignDealer]);
    const t = parseNumber(row[trust]);
    const d = parseNumber(row[dealer]);
    if (!ticker || f === null || fd === null || t === null || d === null) return null;
    // Foreign totals include the foreign-dealer book so the figure matches
    // what TPEx reports as 外資及陸資合計 on the other exchange.
    return [ticker, { foreignNetShares: f + fd, trustNetShares: t, dealerNetShares: d }];
  });
}

/** TWSE MI_MARGN 融資融券彙總: per-stock change in the financing balance, in 張. */
export function parseTwseMargin(payload: TwseTableResponse, day: Date): Map<string, number> {
  const report = "TWSE MI_MARGN";
  if (twseHasNoData(payload)) throw new NotPublishedError(report, dayString(day));
  if (payload.stat !== "OK") throw new Error(`${report} answered "${payload.stat}"`);
  const table = payload.tables?.find((t) => t?.title?.includes("融資融券彙總"));
  if (!table) throw new Error(`${report} layout changed: no 融資融券彙總 table`);
  requireSession(report, rocTitleToDate(table.title ?? ""), day);
  if (!table.data?.length) throw new NotPublishedError(report, dayString(day));

  // 前日餘額 / 今日餘額 appear twice — once under 融資, once under 融券 — and
  // the first pair is the financing one only while 融資 is the first group
  // after the two identity columns.
  if (table.groups && table.groups[1]?.title !== "融資") {
    throw new Error(`${report} layout changed: groups are [${table.groups.map((g) => g.title).join(", ")}]`);
  }
  const code = fieldIndex(report, table.fields, "代號");
  const prior = fieldIndex(report, table.fields, "前日餘額");
  const today = fieldIndex(report, table.fields, "今日餘額");

  return collect(report, table.data, (row) => {
    const ticker = String(row[code] ?? "").trim();
    const before = parseNumber(row[prior]);
    const after = parseNumber(row[today]);
    if (!ticker || before === null || after === null) return null;
    return [ticker, after - before];
  });
}

/**
 * TPEx 三大法人買賣明細, per stock, in shares.
 *
 * Its 24 columns repeat the same three names (買進股數 / 賣出股數 / 買賣超股數)
 * for each investor group, so they cannot be found by name. The positions are
 * checked instead against the report's own arithmetic, which holds exactly on
 * every row published (902 of 902 on 11-17): 外資合計 = 外資不含自營 + 外資自營商,
 * and 三大法人合計 = 外資合計 + 投信 + 自營合計. A shifted column breaks both.
 */
export function parseTpexFlows(payload: TpexTableResponse, day: Date): Map<string, NetFlows> {
  const report = "TPEx 三大法人";
  const table = payload.tables?.[0];
  if (!table) throw new Error(`${report} layout changed: no table`);
  requireSession(report, rocSlashToDate(table.date ?? ""), day);
  if (!table.data?.length) throw new NotPublishedError(report, dayString(day));
  const fields = table.fields ?? [];
  if (fields.length !== 24 || !fields[23]?.includes("三大法人買賣超股數合計")) {
    throw new Error(`${report} layout changed: [${fields.join(", ")}]`);
  }

  // 0 代號, 1 名稱, then buy/sell/net triplets:
  // 2-4 外資不含自營, 5-7 外資自營商, 8-10 外資合計,
  // 11-13 投信, 14-16 自營自行, 17-19 自營避險, 20-22 自營合計, 23 三大法人合計
  let inconsistent = 0;
  const out = collect(report, table.data, (row) => {
    const ticker = String(row[0] ?? "").trim();
    const [foreignEx, foreignDealer, foreign, trust, dealer, total] = [4, 7, 10, 13, 22, 23].map((i) =>
      parseNumber(row[i]),
    );
    if (!ticker || foreign === null || trust === null || dealer === null) return null;
    if (foreignEx === null || foreignDealer === null || total === null) return null;
    if (foreign !== foreignEx + foreignDealer || total !== foreign + trust + dealer) inconsistent++;
    return [ticker, { foreignNetShares: foreign, trustNetShares: trust, dealerNetShares: dealer }];
  });
  if (inconsistent > table.data.length / 2) {
    throw new Error(`${report} layout changed: ${inconsistent}/${table.data.length} rows fail the 合計 identities`);
  }
  return out;
}

/** TPEx 融資融券餘額: per-stock change in the financing balance, in 張. */
export function parseTpexMargin(payload: TpexTableResponse, day: Date): Map<string, number> {
  const report = "TPEx 融資融券餘額";
  const table = payload.tables?.[0];
  if (!table) throw new Error(`${report} layout changed: no table`);
  requireSession(report, rocSlashToDate(table.date ?? ""), day);
  if (!table.data?.length) throw new NotPublishedError(report, dayString(day));

  const code = fieldIndex(report, table.fields, "代號");
  const prior = fieldIndex(report, table.fields, "前資餘額(張)");
  const today = fieldIndex(report, table.fields, "資餘額");

  return collect(report, table.data, (row) => {
    const ticker = String(row[code] ?? "").trim();
    const before = parseNumber(row[prior]);
    const after = parseNumber(row[today]);
    if (!ticker || before === null || after === null) return null;
    return [ticker, after - before];
  });
}
