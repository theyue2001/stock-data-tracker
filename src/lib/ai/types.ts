import type { AIGeneratedBy } from "@/lib/types";

/** Aggregated, already-computed facts handed to the AI layer as context.
 *  The AI provider must not invent numbers outside of this input. */
export interface DailyBriefContext {
  date: string; // ISO date
  marketStatus: {
    index: string;
    close: number;
    changePct: number;
    breadthAdvancers: number;
    breadthDecliners: number;
    foreignNet: number;
    trustNet: number;
  } | null;
  industries: Array<{
    name: string;
    slug: string;
    scoreToday: number;
    scoreWeekAgo: number;
    status: string;
    capitalFlowScore: number;
    leadingIndicatorScore: number;
  }>;
  indicatorChanges: Array<{
    industryName: string;
    indicatorName: string;
    value: number;
    previousValue: number | null;
    pctChange: number | null;
    unit: string | null;
  }>;
  topFlows: Array<{
    industryName: string;
    foreignNet: number;
    trustNet: number;
    breakoutCount: number;
  }>;
  /** Short-term Industry Sentiment readings (spec §12). Separate from the
   *  `industries` array above, which carries the medium-term heat score — the
   *  brief is expected to report both without conflating them. */
  sentiment: {
    date: string | null;
    /** Every industry ranked by today's sentiment score. */
    industries: Array<{
      name: string;
      slug: string;
      sentimentScore: number;
      scoreDelta: number;
      rank: number;
      previousRank: number | null;
      rankDelta: number;
      status: string;
      advancingCount: number;
      decliningCount: number;
      stockCount: number;
      volumeRatio: number;
      relativeStrengthPct: number;
      foreignNet: number;
      trustNet: number;
      heatScore: number;
    }>;
    fastestRising: string[];
    fastestFalling: string[];
    biggestRankJumps: string[];
    strongClusters: string[];
    overheated: string[];
  };
  catalysts: Array<{ title: string; industryName: string | null; importance: string }>;
  alerts: Array<{ title: string; industryName: string | null; importance: string; explanation: string }>;
  /** Watched items, kept separate so a stock-specific section never lists an
   *  industry (and vice versa). */
  watchedStocks: string[];
  watchedIndustries: string[];
}

export interface DailyBriefOutput {
  marketSummary: string;
  /** One-paragraph read of today's short-term industry sentiment. */
  sentimentSummary: string;
  sentimentRising: string[];
  sentimentFalling: string[];
  sentimentRankJumps: string[];
  sentimentStrongClusters: string[];
  sentimentOverheated: string[];
  strongestIndustries: string[];
  weakestIndustries: string[];
  capitalRotation: string;
  leadingIndicatorChanges: string[];
  institutionalActivity: string;
  emergingThemes: string[];
  stocksToWatch: string[];
  overheatedThemes: string[];
  keyRisks: string[];
  tomorrowWatchlist: string[];
  knownFacts: string[];
  reasonableInference: string[];
  uncertainty: string[];
  generatedBy: AIGeneratedBy;
}

export interface AIBriefProvider {
  name: AIGeneratedBy;
  generateDailyBrief(context: DailyBriefContext): Promise<DailyBriefOutput>;
}
