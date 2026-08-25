import { fetchJsonOptional } from "@/lib/providers/live/http";
import {
  parseLeadingCount,
  parseNumber,
  rocCompactToDate,
  rocSlashToDate,
  toTwseDateParam,
} from "@/lib/providers/live/parse";
import type { MarketStatusProvider, MarketStatusResult, ProviderSource } from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Market-wide TAIEX status: index level, turnover, advance/decline breadth,
 * market-level institutional net buying, and the change in total margin
 * financing.
 *
 * Assembled from four separate TWSE reports rather than approximated from the
 * 55 tracked stocks. Breadth over a hand-picked watchlist is not market
 * breadth, and relative strength measured against a synthetic index is not
 * relative strength — both feed the scores directly.
 *
 * The four reports differ enormously in cost, and the split below is the whole
 * reason this class has the shape it does:
 *
 *  - FMTQIK carries index close, point change and volume for a WHOLE MONTH in
 *    one request. Nine requests cover a year.
 *  - Breadth, institutional flow and margin are published per session, so
 *    covering the same year costs ~750 requests to a host that IP-blocks a
 *    client for sustained iteration over one report path.
 *
 * So the cheap leg (`fetchSessions`) and the expensive leg
 * (`fetchSessionDetail`) are separate entry points, and the caller decides how
 * far back it is worth paying for detail. `fetchRange` keeps the
 * MarketStatusProvider contract by combining them over a bounded window.
 */

const FMTQIK = "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK";
const MI_INDEX = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";
const BFI82U = "https://www.twse.com.tw/rwd/zh/fund/BFI82U";
const MI_MARGN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TWSE_SNAPSHOT_DATE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";

interface TwseTableResponse {
  stat?: string;
  fields?: string[];
  data?: string[][];
  tables?: Array<{ title?: string; fields?: string[]; data?: string[][] }>;
}

/** The cheap leg: index level, point change and turnover for one session. */
export interface SessionCore {
  date: Date;
  close: number;
  change: number;
  /**
   * Market turnover in NT$ (成交金額) — NOT share count.
   *
   * `MarketStatus.volume` and `MarketData.volume` are the same column name with
   * different units, which is a trap worth spelling out: per-stock volume is
   * shares, because the volume-expansion ratio compares a stock against its own
   * trailing share volume, while the market figure is currency, because the UI
   * renders it as 成交金額 in 億 (`raw / 1e8`). Feeding 成交股數 here yields a
   * plausible-looking number roughly 50x too small.
   */
  volume: number;
}

/** The expensive leg: everything published per session. */
export interface SessionDetail {
  breadthAdvancers: number | null;
  breadthDecliners: number | null;
  foreignNet: number | null;
  trustNet: number | null;
  dealerNet: number | null;
  marginChange: number | null;
}

const EMPTY_DETAIL: SessionDetail = {
  breadthAdvancers: null,
  breadthDecliners: null,
  foreignNet: null,
  trustNet: null,
  dealerNet: null,
  marginChange: null,
};

export class TwseMarketStatusProvider implements MarketStatusProvider {
  readonly source: ProviderSource = {
    key: "twse-market-status",
    name: "TWSE Market Statistics (TAIEX)",
    category: "market_data",
    url: "https://www.twse.com.tw/zh/trading/historical/fmtqik.html",
    isMock: false,
    description:
      "TAIEX close and turnover (FMTQIK), advance/decline breadth (MI_INDEX), market-level three-institution net buying (BFI82U), and total margin financing balance (MI_MARGN).",
  };

  async fetchLatest(): Promise<MarketStatusResult[]> {
    const date = await latestSessionDate();
    if (!date) return [];
    return this.fetchRange(date, date);
  }

  /** Contract-satisfying combination of both legs. Only use over a short
   *  window; the backfill drives the two legs separately so it can pay for
   *  detail over a narrower range than it pays for prices. */
  async fetchRange(from: Date, to: Date): Promise<MarketStatusResult[]> {
    const sessions = await this.fetchSessions(from, to);
    const results: MarketStatusResult[] = [];
    for (const session of sessions) {
      results.push(toResult(session, await this.fetchSessionDetail(session.date)));
    }
    return results;
  }

  /**
   * Index close, point change and turnover for every session in the range.
   * One request per calendar month, which is why the full history is affordable
   * even when per-session detail is not.
   */
  async fetchSessions(from: Date, to: Date): Promise<SessionCore[]> {
    const out: SessionCore[] = [];
    const fromDay = utcDay(from).getTime();
    const toDay = utcDay(to).getTime();

    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cursor.getTime() <= end.getTime()) {
      const payload = await fetchJsonOptional<TwseTableResponse>(
        `${FMTQIK}?date=${toTwseDateParam(cursor)}&response=json`,
      );
      // 日期, 成交股數, 成交金額, 成交筆數, 發行量加權股價指數, 漲跌點數
      for (const row of payload?.data ?? []) {
        const date = rocSlashToDate(row[0] ?? "");
        const close = parseNumber(row[4]);
        if (!date || close === null) continue;
        const time = date.getTime();
        if (time < fromDay || time > toDay) continue;
        out.push({
          date,
          close,
          change: parseNumber(row[5]) ?? 0,
          // 成交金額 (index 2), not 成交股數 (index 1) — see SessionCore.volume.
          volume: parseNumber(row[2]) ?? 0,
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out;
  }

  /**
   * Breadth, market-level institutional net buying and margin change for one
   * session — three requests to the rate-limited host.
   *
   * Every field is independently nullable, and a field that could not be
   * fetched stays null rather than defaulting to zero. Zero is a real reading
   * here ("no net foreign buying", "no stocks advanced") and inventing it
   * would be indistinguishable from having measured it.
   *
   * The Promise.all buys no concurrency, and no future edit here can: http.ts
   * serializes every www.twse.com.tw request through one per-host queue, so
   * these three cost three throttle intervals however they are written. It
   * stays because it reads as one unit of work — but the only way to spend
   * less on this leg is to ask for fewer sessions, not to fire more requests
   * at once.
   */
  async fetchSessionDetail(date: Date): Promise<SessionDetail> {
    const [breadth, institutional, margin] = await Promise.all([
      this.fetchBreadth(date),
      this.fetchInstitutional(date),
      this.fetchMarginChange(date),
    ]);

    return {
      breadthAdvancers: breadth?.advancers ?? null,
      breadthDecliners: breadth?.decliners ?? null,
      foreignNet: institutional?.foreignNet ?? null,
      trustNet: institutional?.trustNet ?? null,
      dealerNet: institutional?.dealerNet ?? null,
      marginChange: margin,
    };
  }

  private async fetchBreadth(date: Date): Promise<{ advancers: number; decliners: number } | null> {
    const payload = await fetchJsonOptional<TwseTableResponse>(
      `${MI_INDEX}?date=${toTwseDateParam(date)}&type=MS&response=json`,
    );
    const table = payload?.tables?.find((t) => t.title?.includes("漲跌證券數"));
    if (!table?.data) return null;

    // Columns are [類型, 整體市場, 股票]. The 股票 column is the one that means
    // anything here — 整體市場 is dominated by warrants, which swamp the count
    // and make breadth read as permanently negative.
    const pick = (label: string) => {
      const row = table.data?.find((r) => String(r[0] ?? "").startsWith(label));
      return row ? parseLeadingCount(row[2]) : null;
    };
    const advancers = pick("上漲");
    const decliners = pick("下跌");
    if (advancers === null || decliners === null) return null;
    return { advancers, decliners };
  }

  /** Market-level net buying in NT$ thousands. */
  private async fetchInstitutional(
    date: Date,
  ): Promise<{ foreignNet: number; trustNet: number; dealerNet: number } | null> {
    const payload = await fetchJsonOptional<TwseTableResponse>(
      `${BFI82U}?dayDate=${toTwseDateParam(date)}&type=day&response=json`,
    );
    if (payload?.stat !== "OK" || !payload.data) return null;

    // Rows are 單位名稱 / 買進金額 / 賣出金額 / 買賣差額, all in NT$. The six names
    // are 自營商(自行買賣), 自營商(避險), 投信, 外資及陸資(不含外資自營商), 外資自營商
    // and 合計.
    //
    // Each predicate is anchored at the start of the name, and the cell is
    // trimmed because startsWith is whitespace-sensitive where includes was
    // not. The anchoring is the load-bearing part: TWSE spells the main foreign
    // row 外資及陸資(不含外資自營商), so an unanchored includes("自營商") matches
    // that parenthetical disclaimer as well and folds the whole foreign net
    // into the dealer figure on every single session.
    const net = (predicate: (name: string) => boolean) =>
      (payload.data ?? [])
        .filter((r) => predicate(String(r[0] ?? "").trim()))
        .reduce((sum, r) => sum + (parseNumber(r[3]) ?? 0), 0);

    return {
      // Foreign keeps the foreign-dealer book (外資自營商), the way the
      // per-stock feed is summed in flow-provider.ts (外陸資不含外資自營商 +
      // 外資自營商). TWSE's footnote on this report says that amount is
      // already counted inside the 自營商 rows, which is why its own 合計
      // leaves it out separately; it has been zero on every session probed, so
      // if it ever goes non-zero both feeds have to be revisited together
      // rather than only this one.
      foreignNet: net((n) => n.startsWith("外資")) / 1000,
      trustNet: net((n) => n.startsWith("投信")) / 1000,
      // 自營商(自行買賣) + 自營商(避險) only: 外資自營商 does not start
      // with 自營商. Anchored this way the three fields reconcile exactly to
      // the report's own 合計 row, which is the check that says the split is
      // the one TWSE itself uses.
      dealerNet: net((n) => n.startsWith("自營商")) / 1000,
    };
  }

  /** Change in the total margin financing balance, in NT$ thousands. */
  private async fetchMarginChange(date: Date): Promise<number | null> {
    const payload = await fetchJsonOptional<TwseTableResponse>(
      `${MI_MARGN}?date=${toTwseDateParam(date)}&selectType=ALL&response=json`,
    );
    const table = payload?.tables?.find((t) => t.title?.includes("信用交易統計"));
    const row = table?.data?.find((r) => String(r[0] ?? "").startsWith("融資金額"));
    if (!row) return null;

    // 項目, 買進, 賣出, 現金(券)償還, 前日餘額, 今日餘額 — already in 仟元.
    const prior = parseNumber(row[4]);
    const today = parseNumber(row[5]);
    if (prior === null || today === null) return null;
    return today - prior;
  }
}

/** Combines the two legs into the row shape the writer expects. */
export function toResult(session: SessionCore, detail: SessionDetail = EMPTY_DETAIL): MarketStatusResult {
  const priorClose = session.close - session.change;
  return {
    date: session.date,
    index: "TAIEX",
    close: session.close,
    change: session.change,
    changePct: priorClose > 0 ? (session.change / priorClose) * 100 : 0,
    volume: session.volume,
    ...detail,
  };
}

/**
 * The date of the most recently published whole-market snapshot.
 *
 * The openapi mirror is regenerated in TWSE's nightly batch, so it still serves
 * session D at around 05:20 Taipei on D+1 — well after the evening cron. On an
 * evening run it can therefore name yesterday while the RWD reports fetched
 * above already carry today's session.
 *
 * It stays the source anyway because flow-provider.ts and market-data-provider.ts
 * resolve their session from the same mirror: a fresher date here alone would
 * name a session whose prices and per-stock flows are not stored yet, which is
 * worse than a lag that is at least uniform. Moving off it means moving all
 * three call sites together, and gating the newer date on the per-session
 * reports (T86, MI_MARGN) actually being published for it — they lag FMTQIK by
 * hours on the session day itself.
 */
export async function latestSessionDate(): Promise<Date | null> {
  const rows = await fetchJsonOptional<Array<{ Date?: string }>>(TWSE_SNAPSHOT_DATE);
  const stamp = rows?.[0]?.Date;
  return stamp ? rocCompactToDate(stamp) : null;
}
