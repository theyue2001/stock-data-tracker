// Generic provider contracts. Live integrations (TWSE, TPEx, MOPS, SEC EDGAR)
// and the mock generators implement the same interfaces, so the rest of the
// app never needs to know whether a value came from an official feed or a
// synthetic generator. Swap the registry wiring in
// src/lib/providers/registry.ts to change what is live.

/** How a stock is addressed at the exchange feeds. Backfills and daily pulls
 *  both need the exchange, because TWSE and TPEx publish on separate hosts
 *  with different payload shapes. */
export interface StockRef {
  ticker: string;
  exchange: string; // "TWSE" | "TPEx"
}

/**
 * Provenance a provider declares about itself. The refresh job upserts this
 * into the DataSource table and stamps every row it writes with the resulting
 * id, so `isMock` on a stored row always reflects the provider that actually
 * produced it rather than a hard-coded assumption at the write site.
 */
export interface ProviderSource {
  key: string;
  name: string;
  category: "market_data" | "institutional_flow" | "indicator" | "news" | "fundamental";
  url?: string;
  isMock: boolean;
  description?: string;
}

// ---------------------------------------------------------------------------
// Leading indicators
// ---------------------------------------------------------------------------

export interface IndicatorResult {
  /** Matches Indicator.key in the schema, e.g. "scfi", "hyperscaler_capex" */
  indicatorKey: string;
  date: Date;
  value: number;
  sourceUrl?: string;
}

export interface IndicatorProvider {
  source: ProviderSource;
  fetchLatest(): Promise<IndicatorResult[]>;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface MarketQuote {
  ticker: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Shares traded. */
  volume: number;
  /** Close minus the previous close, as reported by the exchange. */
  change?: number | null;
}

export interface MarketDataProvider {
  source: ProviderSource;
  /** The most recent published session for the given stocks. */
  fetchLatest(stocks: StockRef[]): Promise<MarketQuote[]>;
  /** Every published session in [from, to]. Used by the history backfill;
   *  optional because a real-time-only feed cannot serve it. */
  fetchRange?(stocks: StockRef[], from: Date, to: Date): Promise<MarketQuote[]>;
}

// ---------------------------------------------------------------------------
// Institutional / capital flow
// ---------------------------------------------------------------------------

export interface InstitutionalFlowResult {
  date: Date;
  scope: "market" | "industry" | "stock";
  industryKey?: string; // Industry.slug
  ticker?: string; // Stock.ticker
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  marginChange: number;
  turnover: number;
  volumeChangePct: number;
  breakoutCount?: number;
  /**
   * Unit of the four net-flow figures above. Both exchanges publish per-stock
   * institutional trading in SHARES, never in currency, so a live provider
   * cannot report NT$ without a price it does not have. It declares "shares"
   * instead and the refresh job converts using the same session close it just
   * stored. Defaults to "twd_thousands", which is what the schema stores and
   * what the UI formats.
   */
  unit?: "shares" | "twd_thousands";
}

export interface InstitutionalFlowProvider {
  source: ProviderSource;
  fetchLatest(stocks: StockRef[]): Promise<InstitutionalFlowResult[]>;
  /** One specific session, for the backfill. */
  fetchForDate?(stocks: StockRef[], date: Date): Promise<InstitutionalFlowResult[]>;
}

// ---------------------------------------------------------------------------
// Market-wide status (TAIEX)
// ---------------------------------------------------------------------------

export interface MarketStatusResult {
  date: Date;
  index: string;
  close: number;
  change: number;
  changePct: number;
  /** Shares traded market-wide. */
  volume: number;
  /**
   * Everything below is published per session by a separate, rate-limited
   * report, and is therefore independently nullable: null means "not
   * fetched for this session", not "zero".
   *
   * The distinction is load-bearing. Zero is a legitimate reading for every
   * one of these fields — no net foreign buying, no advancing stocks — so
   * defaulting an unfetched value to zero produces a row that is
   * indistinguishable from a measured one. The writer skips null fields
   * instead, leaving the column at its default on insert and untouched on
   * update, so a later re-run fills the gap rather than overwriting good data.
   */
  breadthAdvancers: number | null;
  breadthDecliners: number | null;
  foreignNet: number | null; // NT$ thousands
  trustNet: number | null;
  dealerNet: number | null;
  marginChange: number | null;
}

export interface MarketStatusProvider {
  source: ProviderSource;
  fetchLatest(): Promise<MarketStatusResult[]>;
  fetchRange?(from: Date, to: Date): Promise<MarketStatusResult[]>;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export interface FundamentalResult {
  ticker: string;
  /** "2026-07" for monthly revenue, "2026Q2" for quarterly EPS. */
  period: string;
  periodType: "monthly_revenue" | "quarterly_eps";
  /** Revenue in NT$ thousands, or net income for a quarterly row. */
  value: number;
  yoyChangePct?: number | null;
  momChangePct?: number | null;
  eps?: number | null;
}

export interface FundamentalProvider {
  source: ProviderSource;
  fetchLatest(stocks: StockRef[]): Promise<FundamentalResult[]>;
  /** The trailing `months` monthly-revenue periods, for the backfill. */
  fetchHistory?(stocks: StockRef[], months: number, asOf?: Date): Promise<FundamentalResult[]>;
}

// ---------------------------------------------------------------------------
// News / catalysts
// ---------------------------------------------------------------------------

export interface NewsCatalystResult {
  industryKey?: string;
  ticker?: string;
  title: string;
  description?: string;
  date: Date;
  importance: "high" | "medium" | "low";
  /** Publisher / filing venue, e.g. "MOPS 重大訊息". */
  source?: string;
  sourceUrl?: string;
}

export interface NewsProvider {
  source: ProviderSource;
  fetchLatest(stocks: StockRef[]): Promise<NewsCatalystResult[]>;
}
