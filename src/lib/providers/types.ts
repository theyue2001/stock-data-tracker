// Generic provider contracts. Real integrations (TWSE, TAIFEX, freight
// indices, TrendForce, news APIs, ...) implement these same interfaces so
// the rest of the app never needs to know whether a value came from a mock
// generator or a live scrape/API call. Swap the registry wiring in
// src/lib/providers/registry.ts to go live with a real source.

export interface IndicatorResult {
  /** Matches Indicator.key in the schema, e.g. "scfi", "dram_contract_price" */
  indicatorKey: string;
  date: Date;
  value: number;
  sourceUrl?: string;
}

export interface IndicatorProvider {
  /** Unique key registered in DataSource, e.g. "mock-freight" */
  sourceKey: string;
  fetchLatest(): Promise<IndicatorResult[]>;
}

export interface MarketQuote {
  ticker: string;
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataProvider {
  sourceKey: string;
  fetchLatest(tickers: string[]): Promise<MarketQuote[]>;
}

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
}

export interface InstitutionalFlowProvider {
  sourceKey: string;
  fetchLatest(): Promise<InstitutionalFlowResult[]>;
}

export interface NewsCatalystResult {
  industryKey?: string;
  ticker?: string;
  title: string;
  description?: string;
  date: Date;
  importance: "high" | "medium" | "low";
  sourceUrl?: string;
}

export interface NewsProvider {
  sourceKey: string;
  fetchLatest(): Promise<NewsCatalystResult[]>;
}
