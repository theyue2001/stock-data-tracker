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
// Intraday index level
// ---------------------------------------------------------------------------

export interface IntradayIndexResult {
  date: Date;
  index: string;
  last: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  /** Exchange-reported time of the last tick, "HH:mm:ss". */
  tickAt: string;
  /**
   * The same tick as an exact instant (epoch ms), when the feed reports one
   * (MIS `tlong`). Not persisted — IntradayIndex keeps only `tickAt` — but the
   * job log records it as the dataset's `sourceAsOf`, which is what tells a
   * fresh tick apart from the feed repeating an old one.
   */
  tickEpochMs?: number;
}

export interface IntradayIndexProvider {
  source: ProviderSource;
  /**
   * The shortest poll interval this source permits, in seconds — set by its
   * terms of use and rate tolerance, not by what this code could manage. The
   * scheduler clamps INTRADAY_INTERVAL_SECONDS up to the largest value among
   * the registered intraday providers, and the intraday job refuses a call
   * that comes sooner, so neither a config typo nor an over-eager external
   * cron can poll a source faster than it allows.
   */
  readonly minIntervalSeconds: number;
  /** Empty array means "no tick yet for this session" (pre-market, or the
   *  feed has nothing new) — never a zero-filled row. Throws when the feed
   *  answers with something that cannot be a valid tick. */
  fetchLatest(): Promise<IntradayIndexResult[]>;
}

// ---------------------------------------------------------------------------
// Intraday per-stock quotes — contract for a FUTURE licensed real-time feed.
// Nothing implements it yet; see `intradayQuoteProviders` in registry.ts for
// why, and for what wiring one in involves.
// ---------------------------------------------------------------------------

/** One stock's quote from a licensed real-time (or licensed delayed) feed. */
export interface IntradayQuote {
  ticker: string;
  /** Last traded price. Never a bid/ask midpoint, a reference price or the
   *  prior close standing in for a stock that has not traded yet — such a
   *  stock is simply absent from the result. */
  price: number;
  /** `price` minus the prior session's close. */
  change: number;
  changePct: number;
  /** Shares traded so far this session, up to `tickAt`. */
  volume: number;
  /** Best bid / ask at `tickAt`, when the licence includes depth. */
  bid?: number;
  ask?: number;
  /** Exchange time of the trade behind `price`. */
  tickAt: Date;
  /**
   * How far behind real time the licence makes this feed, in seconds (0 =
   * real time; vendor "delayed" tiers are typically 900–1200). Carried per
   * quote so the UI can label a delayed price as delayed instead of passing
   * it off as live.
   */
  delayedSeconds: number;
}

export interface IntradayQuoteProvider {
  source: ProviderSource;
  /** Shortest poll interval the licence / vendor allows, in seconds. Same
   *  clamping rules as IntradayIndexProvider.minIntervalSeconds. */
  readonly minIntervalSeconds: number;
  /**
   * Always `true`, as a type-level gate: only a feed covered by a written
   * redistribution agreement may implement this interface. A public viewing
   * page scraped per stock (e.g. mis.twse.com.tw) cannot honestly declare it.
   */
  readonly licensed: true;
  /** Latest quote for each of `stocks` that has traded this session. */
  fetchQuotes(stocks: StockRef[]): Promise<IntradayQuote[]>;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export interface FundamentalResult {
  ticker: string;
  /** "2026-07" for monthly revenue, "2026Q2" for a year-to-date EPS row —
   *  which names the quarter the statement CLOSES, not a quarter in isolation. */
  period: string;
  periodType: "monthly_revenue" | "ytd_eps";
  /** Revenue in NT$ thousands for a monthly row, or year-to-date net income
   *  (cumulative from January) for a "ytd_eps" row. */
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
