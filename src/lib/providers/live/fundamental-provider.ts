import { fetchJsonOptional, fetchText, HttpError } from "@/lib/providers/live/http";
import { decodeHtmlEntities, parseNumber, rocMonthToPeriod } from "@/lib/providers/live/parse";
import type { FundamentalProvider, FundamentalResult, ProviderSource, StockRef } from "@/lib/providers/types";

/**
 * Monthly revenue and year-to-date EPS as filed with MOPS (公開資訊觀測站).
 *
 * Monthly revenue is the fastest hard confirmation any Taiwan-listed company
 * publishes — the 10th of the following month, versus a quarter-plus wait for
 * financials — which is why the heat score weights it at 30%. It is sourced
 * two ways:
 *
 *  - The current month comes from the OpenAPI summary feeds, which carry the
 *    YoY and MoM percentages already computed by MOPS.
 *  - Earlier months come from the MOPS 彙總表 pages, which are still served
 *    as Big5 HTML and have no JSON equivalent. Backfilling matters because
 *    the fundamental component compares against the same month a year ago,
 *    and a single stored month gives it nothing to compare.
 *
 * The earnings side is YEAR-TO-DATE, not per-quarter, and the name of the
 * period it is filed under invites the opposite reading. t187ap14 publishes the
 * latest filed financial statement, and that statement accumulates from January
 * and resets only at Q1: for 2026Q2 both 基本每股盈餘 and 稅後淨利 cover Jan–Jun,
 * so treating either as one quarter's earnings overstates it by roughly the
 * quarter number. The feed carries a single quarter at a time, with no prior
 * cumulative to subtract, so the figure cannot be de-cumulated here — it is
 * stored as filed, and anything that displays it has to say "cumulative".
 */

const TWSE_REVENUE = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L";
const TPEX_REVENUE = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O";
const TWSE_EPS = "https://openapi.twse.com.tw/v1/opendata/t187ap14_L";
const TPEX_EPS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O";
/** Legacy MOPS summary page. `sii` = TWSE-listed, `otc` = TPEx-listed. */
const MOPS_MONTHLY = "https://mopsov.twse.com.tw/nas/t21";
/**
 * Trailing digit of the 彙總表 filename, and the reason this is a loop rather
 * than a constant: MOPS splits each board's issuers across two pages of
 * identical layout. `_0` is the domestically registered universe and `_1` the
 * foreign-registered one — the -KY / F-share companies. Reading only `_0`
 * costs 94 TWSE and 30 TPEx issuers per month, and does so in silence, since
 * the page it fetches returns 200 and simply has no row for them. `_2` and
 * above are 404, and the two ticker sets are disjoint, so the extra pass
 * neither duplicates rows nor generates warning noise.
 */
const MOPS_UNIVERSES = ["0", "1"] as const;

interface TwseRevenueRow {
  資料年月?: string;
  公司代號?: string;
  "營業收入-當月營收"?: string;
  "營業收入-上月比較增減(%)"?: string;
  "營業收入-去年同月增減(%)"?: string;
}

interface TpexRevenueRow extends TwseRevenueRow {
  SecuritiesCompanyCode?: string;
}

interface EpsRow {
  年度?: string;
  Year?: string;
  季別?: string;
  公司代號?: string;
  SecuritiesCompanyCode?: string;
  "基本每股盈餘(元)"?: string;
  基本每股盈餘?: string;
  稅後淨利?: string;
}

export class MopsFundamentalProvider implements FundamentalProvider {
  readonly source: ProviderSource = {
    key: "mops-fundamentals",
    name: "MOPS Monthly Revenue & Year-to-Date EPS",
    category: "fundamental",
    url: "https://mops.twse.com.tw/",
    isMock: false,
    description:
      "Company-filed monthly operating revenue (t187ap05) and year-to-date basic EPS (t187ap14, cumulative from January and reset at Q1) as published on the Market Observation Post System.",
  };

  async fetchLatest(stocks: StockRef[]): Promise<FundamentalResult[]> {
    const wanted = new Set(stocks.map((s) => s.ticker));
    const [revenue, eps] = await Promise.all([this.fetchLatestRevenue(wanted), this.fetchLatestEps(wanted)]);
    return [...revenue, ...eps];
  }

  /** Monthly revenue for the trailing `months` periods, oldest first.
   *  Fetches 13 months when asked for 12 so every period still has its
   *  year-earlier comparison inside the stored window. */
  async fetchHistory(stocks: StockRef[], months: number, asOf: Date = new Date()): Promise<FundamentalResult[]> {
    const wanted = new Set(stocks.map((s) => s.ticker));
    const out: FundamentalResult[] = [];

    for (let back = months; back >= 1; back--) {
      const cursor = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - back, 1));
      const rocYear = cursor.getUTCFullYear() - 1911;
      const month = cursor.getUTCMonth() + 1;
      const period = `${cursor.getUTCFullYear()}-${String(month).padStart(2, "0")}`;

      for (const board of ["sii", "otc"] as const) {
        for (const variant of MOPS_UNIVERSES) {
          const url = `${MOPS_MONTHLY}/${board}/t21sc03_${rocYear}_${month}_${variant}.html`;
          try {
            // These pages predate UTF-8 on MOPS and are still Big5.
            const html = await fetchText(url, { encoding: "big5" });
            out.push(...parseMopsMonthlyRevenue(html, period, wanted));
          } catch (error) {
            // A month that was never published (too far back, or not yet filed)
            // is expected, not exceptional.
            if (error instanceof HttpError && error.status === 404) continue;
            console.warn(
              `[fundamentals] ${board}/${variant} ${period} skipped: ${(error as Error).message}`,
            );
          }
        }
      }
    }

    return out;
  }

  private async fetchLatestRevenue(wanted: Set<string>): Promise<FundamentalResult[]> {
    const [twse, tpex] = await Promise.all([
      fetchJsonOptional<TwseRevenueRow[]>(TWSE_REVENUE),
      fetchJsonOptional<TpexRevenueRow[]>(TPEX_REVENUE),
    ]);

    const out: FundamentalResult[] = [];
    for (const row of [...(twse ?? []), ...(tpex ?? [])]) {
      const ticker = (row.公司代號 ?? (row as TpexRevenueRow).SecuritiesCompanyCode ?? "").trim();
      if (!wanted.has(ticker)) continue;
      const period = rocMonthToPeriod(row.資料年月 ?? "");
      const value = parseNumber(row["營業收入-當月營收"]);
      if (!period || value === null) continue;
      out.push({
        ticker,
        period,
        periodType: "monthly_revenue",
        value, // NT$ thousands, as filed
        yoyChangePct: parseNumber(row["營業收入-去年同月增減(%)"]),
        momChangePct: parseNumber(row["營業收入-上月比較增減(%)"]),
      });
    }
    return out;
  }

  private async fetchLatestEps(wanted: Set<string>): Promise<FundamentalResult[]> {
    const [twse, tpex] = await Promise.all([
      fetchJsonOptional<EpsRow[]>(TWSE_EPS),
      fetchJsonOptional<EpsRow[]>(TPEX_EPS),
    ]);

    const out: FundamentalResult[] = [];
    for (const row of [...(twse ?? []), ...(tpex ?? [])]) {
      const ticker = (row.公司代號 ?? row.SecuritiesCompanyCode ?? "").trim();
      if (!wanted.has(ticker)) continue;
      const rocYear = parseNumber(row.年度 ?? row.Year);
      const quarter = parseNumber(row.季別);
      // Both of these are cumulative from January, so 2026Q2 carries Jan–Jun
      // and only a Q1 row is ever a single quarter on its own. `period` names
      // the quarter the statement closes, not a quarter in isolation.
      const eps = parseNumber(row["基本每股盈餘(元)"] ?? row.基本每股盈餘);
      if (rocYear === null || quarter === null) continue;
      out.push({
        ticker,
        period: `${rocYear + 1911}Q${quarter}`,
        // Kept as "quarterly_eps" despite the year-to-date semantics because
        // this string is the read key in queries.ts and part of the row's
        // unique key; renaming it here alone would drop the EPS column rather
        // than relabel it. The honest wording belongs on the display header.
        periodType: "quarterly_eps",
        value: parseNumber(row.稅後淨利) ?? 0, // year-to-date net income, NT$ thousands
        eps,
      });
    }
    return out;
  }
}

/**
 * Extracts one row per company from a MOPS 每月營業收入彙總表 page.
 *
 * The page is a stack of per-industry tables of identical shape, so rows are
 * matched structurally rather than by locating a particular table:
 * 公司代號, 公司名稱, 當月營收, 上月營收, 去年當月營收, 上月增減%, 去年同月增減%, ...
 */
export function parseMopsMonthlyRevenue(
  html: string,
  period: string,
  wanted: Set<string>,
): FundamentalResult[] {
  const out: FundamentalResult[] = [];

  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeHtmlEntities(c[1].replace(/<[^>]*>/g, "")).trim(),
    );
    if (cells.length < 7) continue;

    const ticker = cells[0];
    if (!/^\d{4,6}$/.test(ticker) || !wanted.has(ticker)) continue;

    const value = parseNumber(cells[2]);
    if (value === null) continue;

    out.push({
      ticker,
      period,
      periodType: "monthly_revenue",
      value,
      momChangePct: parseNumber(cells[5]),
      yoyChangePct: parseNumber(cells[6]),
    });
  }

  return out;
}
