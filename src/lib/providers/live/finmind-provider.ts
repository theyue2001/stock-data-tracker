import { fetchJson } from "@/lib/providers/live/http";
import type {
  InstitutionalFlowResult,
  MarketQuote,
  ProviderSource,
  StockRef,
} from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Historical prices and institutional trading from FinMind.
 *
 * A deliberate compromise, and the only third-party source in the app.
 *
 * The exchanges publish per-session reports: covering one stock for eight
 * months costs eight requests, and covering 55 stocks costs several hundred —
 * against a host that enforces a rolling per-client quota and answers a 307
 * block page once it is exceeded. FinMind is organised the other way round: one
 * request returns a whole date range for a stock, so the same history costs 55
 * requests instead of 450.
 *
 * That makes it the right tool for the INITIAL BACKFILL and the wrong tool for
 * everything else. Ongoing collection stays on the official feeds, which are
 * cheap when you only need today. The intended lifecycle is:
 *
 *   1. backfill history here, so the app is usable immediately
 *   2. let the official TWSE catch-up overwrite it as quota allows
 *   3. collect forward from the exchanges from then on
 *
 * Step 2 works because every write is an upsert on (stock, date) that also
 * rewrites `dataSourceId` — so official data replaces these rows in place,
 * provenance included, and the coverage checks in persist.ts are scoped per
 * source so the official run does not treat these rows as already done.
 *
 * FinMind is an aggregator of the same public filings, not an independent
 * measurement, so the values agree with the exchange. It is still recorded as
 * its own DataSource: a user asking "where did this number come from" deserves
 * "FinMind" rather than a claim it came from TWSE directly.
 */

const FINMIND_API = "https://api.finmindtrade.com/api/v4/data";

interface FinMindResponse<T> {
  msg?: string;
  status?: number;
  data?: T[];
}

interface PriceRow {
  date: string;
  stock_id: string;
  Trading_Volume: number;
  open: number;
  max: number;
  min: number;
  close: number;
  spread: number;
}

interface InstitutionalRow {
  date: string;
  stock_id: string;
  name: string;
  buy: number;
  sell: number;
}

interface MarginRow {
  date: string;
  stock_id: string;
  MarginPurchaseTodayBalance: number;
  MarginPurchaseYesterdayBalance: number;
}

/**
 * Maps a FinMind investor label onto the three buckets the schema stores.
 *
 * Foreign deliberately includes the foreign proprietary book
 * (`Foreign_Dealer_Self`) and dealer includes hedging, matching how the TWSE
 * T86 and TPEx feeds are aggregated elsewhere in this app — otherwise the
 * backfilled and forward-collected halves of the same series would be measuring
 * subtly different things.
 */
const INVESTOR_BUCKET: Record<string, "foreign" | "trust" | "dealer"> = {
  Foreign_Investor: "foreign",
  Foreign_Dealer_Self: "foreign",
  Investment_Trust: "trust",
  Dealer_self: "dealer",
  Dealer_Hedging: "dealer",
};

async function finmind<T>(dataset: string, stockId: string, from: Date, to: Date): Promise<T[]> {
  const params = new URLSearchParams({
    dataset,
    data_id: stockId,
    start_date: utcDay(from).toISOString().slice(0, 10),
    end_date: utcDay(to).toISOString().slice(0, 10),
  });
  const payload = await fetchJson<FinMindResponse<T>>(`${FINMIND_API}?${params}`);

  // The free tier answers an exceeded quota with a 200 and a non-success msg,
  // so status alone is not enough to tell data from a refusal.
  if (payload.msg && payload.msg !== "success") {
    throw new Error(`FinMind refused ${dataset} for ${stockId}: ${payload.msg}`);
  }
  return payload.data ?? [];
}

export class FinMindHistoryProvider {
  readonly source: ProviderSource = {
    key: "finmind-history",
    name: "FinMind (historical backfill)",
    category: "market_data",
    url: "https://finmind.github.io/",
    isMock: false,
    description:
      "Third-party aggregator of the same TWSE/TPEx public filings, used only to seed history in bulk. Ongoing collection uses the official feeds, which overwrite these rows in place as quota allows.",
  };

  readonly flowSource: ProviderSource = {
    key: "finmind-history-flow",
    name: "FinMind (historical institutional flow)",
    category: "institutional_flow",
    url: "https://finmind.github.io/",
    isMock: false,
    description:
      "Third-party aggregator of TWSE/TPEx three-institution trading and margin balances, used only to seed history in bulk.",
  };

  /** One request per stock covers the whole range — the reason this exists. */
  async fetchPrices(stock: StockRef, from: Date, to: Date): Promise<MarketQuote[]> {
    const rows = await finmind<PriceRow>("TaiwanStockPrice", stock.ticker, from, to);
    return rows.flatMap((row) => {
      const date = parseIsoDay(row.date);
      if (!date || !(row.close > 0)) return [];
      return [
        {
          ticker: stock.ticker,
          date,
          open: row.open > 0 ? row.open : row.close,
          high: row.max > 0 ? row.max : row.close,
          low: row.min > 0 ? row.min : row.close,
          close: row.close,
          volume: row.Trading_Volume ?? 0, // shares, matching the exchange feeds
          change: row.spread,
        },
      ];
    });
  }

  /**
   * Per-stock institutional net buying and margin change over a date range,
   * as stock-scope rows in SHARES — the same shape and unit the TWSE provider
   * returns, so the refresh job values both the same way.
   */
  async fetchFlows(stock: StockRef, from: Date, to: Date): Promise<InstitutionalFlowResult[]> {
    const [institutional, margin] = await Promise.all([
      finmind<InstitutionalRow>("TaiwanStockInstitutionalInvestorsBuySell", stock.ticker, from, to),
      finmind<MarginRow>("TaiwanStockMarginPurchaseShortSale", stock.ticker, from, to),
    ]);

    // FinMind returns one row per investor type per session, so the buckets
    // have to be summed per date before anything can be written.
    const byDate = new Map<string, { foreign: number; trust: number; dealer: number }>();
    for (const row of institutional) {
      const bucket = INVESTOR_BUCKET[row.name];
      if (!bucket) continue;
      const totals = byDate.get(row.date) ?? { foreign: 0, trust: 0, dealer: 0 };
      totals[bucket] += (row.buy ?? 0) - (row.sell ?? 0);
      byDate.set(row.date, totals);
    }

    const marginByDate = new Map<string, number>();
    for (const row of margin) {
      const today = row.MarginPurchaseTodayBalance;
      const yesterday = row.MarginPurchaseYesterdayBalance;
      if (typeof today !== "number" || typeof yesterday !== "number") continue;
      // Balances are in 張; convert to shares so the writer can value every
      // field with one multiplication by the close.
      marginByDate.set(row.date, (today - yesterday) * 1000);
    }

    const dates = new Set([...byDate.keys(), ...marginByDate.keys()]);
    const results: InstitutionalFlowResult[] = [];
    for (const key of dates) {
      const date = parseIsoDay(key);
      if (!date) continue;
      const totals = byDate.get(key) ?? { foreign: 0, trust: 0, dealer: 0 };
      results.push({
        date,
        scope: "stock",
        ticker: stock.ticker,
        foreignNet: totals.foreign,
        trustNet: totals.trust,
        dealerNet: totals.dealer,
        marginChange: marginByDate.get(key) ?? 0,
        turnover: 0, // derived from stored price data by the writer
        volumeChangePct: 0, // ditto
        unit: "shares",
      });
    }
    return results;
  }
}

function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  return utcDay(new Date(`${value}T00:00:00.000Z`));
}
