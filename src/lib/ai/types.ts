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
  catalysts: Array<{ title: string; industryName: string | null; importance: string }>;
  alerts: Array<{ title: string; industryName: string | null; importance: string; explanation: string }>;
  /** Watched items, kept separate so a stock-specific section never lists an
   *  industry (and vice versa). */
  watchedStocks: string[];
  watchedIndustries: string[];
}

export interface DailyBriefOutput {
  marketSummary: string;
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
