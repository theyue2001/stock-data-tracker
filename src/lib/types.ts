// Shared literal-union "enum" types used across the app.
// Stored as plain strings in SQLite (Prisma enums aren't supported by the
// sqlite connector); these types keep the values checked in TypeScript.

export type CyclePosition = "early" | "expansion" | "peak" | "contraction" | "trough";
export type RiskLevel = "low" | "medium" | "high";

export type IndustryStatus =
  | "accelerating"
  | "strengthening"
  | "neutral"
  | "weakening"
  | "overheated";

export type StockStatus =
  | "early_strengthening"
  | "trend_confirmed"
  | "high_level_consolidation"
  | "potential_catch_up"
  | "overheated"
  | "weakening";

export type TechnicalTrend = "uptrend" | "downtrend" | "neutral" | "breakout" | "breakdown";
export type ValuationPosition = "low" | "mid_range" | "high" | "extended";
export type Importance = "high" | "medium" | "low";
export type Frequency = "daily" | "weekly" | "monthly" | "quarterly";
export type WatchlistItemType = "industry" | "stock" | "indicator";
export type AIGeneratedBy = "mock" | "openai" | "claude";

export const INDUSTRY_STATUS_LABEL: Record<IndustryStatus, string> = {
  accelerating: "Accelerating",
  strengthening: "Strengthening",
  neutral: "Neutral",
  weakening: "Weakening",
  overheated: "Overheated",
};

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  early_strengthening: "Early Strengthening",
  trend_confirmed: "Trend Confirmed",
  high_level_consolidation: "High-Level Consolidation",
  potential_catch_up: "Potential Catch-Up",
  overheated: "Overheated",
  weakening: "Weakening",
};

export interface ScoreComponents {
  fundamentalScore: number;
  leadingIndicatorScore: number;
  capitalFlowScore: number;
  technicalScore: number;
  catalystScore: number;
}

export interface ScoreWeights {
  fundamentalWeight: number;
  leadingIndicatorWeight: number;
  capitalFlowWeight: number;
  technicalWeight: number;
  catalystWeight: number;
}
