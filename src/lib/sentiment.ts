// Industry Sentiment Score — the short-term breadth / participation measure.
//
// This module is PURE: no database, no React, no Prisma types. It is the one
// place the formula lives, so the daily job, the seed backfill, the API and
// any future backtest all agree on what a sentiment score means. UI
// components must never re-derive a component score or hard-code a weight —
// read them from here (weights via src/lib/sentiment-weights.ts).
//
// Deliberately distinct from src/lib/scoring.ts (Industry Heat Score):
//   Sentiment = today's strength, breadth, participation, acceleration.
//   Heat      = medium-term fundamentals, leading indicators, flow, technicals, catalysts.
import type { SentimentComponents, SentimentStatus, SentimentWeights } from "@/lib/types";
import { isLowConfidence, parseWeightRecord, weightParticipated } from "@/lib/weights-snapshot";

/**
 * Default weights per spec §1:
 *   Advancing Stock Ratio 25% + Average Industry Return 20%
 *   + Volume Expansion 15% + Breakout Stock Ratio 15%
 *   + Institutional Flow 15% + Relative Strength vs TAIEX 10%
 *
 * Never read these directly from a component — they are the fallback for
 * when no SentimentWeightConfig row exists yet.
 */
export const DEFAULT_SENTIMENT_WEIGHTS: SentimentWeights = {
  advancingRatioWeight: 0.25,
  averageReturnWeight: 0.2,
  volumeExpansionWeight: 0.15,
  breakoutRatioWeight: 0.15,
  institutionalFlowWeight: 0.15,
  relativeStrengthWeight: 0.1,
};

export const SENTIMENT_WEIGHT_FIELDS = [
  "advancingRatioWeight",
  "averageReturnWeight",
  "volumeExpansionWeight",
  "breakoutRatioWeight",
  "institutionalFlowWeight",
  "relativeStrengthWeight",
] as const;

/** Human labels for each weight, used by the API and any future admin UI. */
export const SENTIMENT_COMPONENT_LABELS: Record<keyof SentimentComponents, { zh: string; en: string }> = {
  advancingRatio: { zh: "漲跌家數", en: "Advancing Ratio" },
  averageReturn: { zh: "平均漲幅", en: "Average Return" },
  volumeExpansion: { zh: "量能擴張", en: "Volume Expansion" },
  breakoutRatio: { zh: "突破家數", en: "Breakout Ratio" },
  institutionalFlowScore: { zh: "法人流向", en: "Institutional Flow" },
  relativeStrengthScore: { zh: "相對強度", en: "Relative Strength" },
};

// ---------------------------------------------------------------------------
// Component normalizers — every one returns 0-100.
//
// Two shapes are used, and the choice is deliberate per component:
//   * A ratio that is ALREADY a share of the group (advancing, breakout) maps
//     linearly, because "8 of 10 up = 80" is exactly the number a reader
//     wants to see and any curve would make it unreadable.
//   * An unbounded signal (return, volume, flow, relative strength) is
//     squashed with tanh around a neutral 50, the same technique
//     compute-scores.ts uses: a linear map pins to 0/100 as soon as the
//     signal is moderately strong, which destroys ranking exactly where it
//     matters most.
// ---------------------------------------------------------------------------

/** `scale` is the signal value that lands at roughly 88 (tanh(1) ≈ 0.76). */
function squash(signal: number, scale: number): number {
  if (scale <= 0) return 50;
  return 50 + 50 * Math.tanh(signal / scale);
}

/** Spec §2: "8 / 10 stocks up = 80". Flat stocks count in the denominator. */
export function advancingRatioScore(advancing: number, total: number): number {
  if (total <= 0) return 50;
  return clamp((advancing / total) * 100, 0, 100);
}

/** Equal-weighted average member return, in percent. A ±2.5% industry day is
 *  a strong one for the Taiwan market, so that is the ~88 / ~12 anchor. */
export function averageReturnScore(avgReturnPct: number): number {
  return squash(avgReturnPct, 2.5);
}

/** Session turnover / trailing 20-session average turnover. 1.0x is neutral
 *  (50); ~1.8x reads as strong expansion, ~0.5x as a group nobody is trading. */
export function volumeExpansionScore(volumeRatio: number): number {
  return squash(volumeRatio - 1, 0.9);
}

/** Share of member stocks in a technical breakout — see src/lib/breakout.ts
 *  for the (modular, swappable) definition of "breakout". Linear for the same
 *  readability reason as the advancing ratio. */
export function breakoutRatioScore(breakouts: number, total: number): number {
  if (total <= 0) return 50;
  return clamp((breakouts / total) * 100, 0, 100);
}

/**
 * Net institutional buying, normalized AT INDUSTRY LEVEL (spec §2) by the
 * industry's own turnover rather than cross-sectionally against the other
 * industries. A cross-sectional max would make a quiet industry's score move
 * whenever some unrelated industry saw a large print; dividing by the group's
 * own turnover asks the stabler question "how much of today's trading in this
 * group was institutional net buying?", which is comparable both across
 * industries of different sizes and across days.
 *
 * Dealer flow is half-weighted: a large share of dealer prints are hedges
 * against warrant issuance rather than directional views.
 *
 * All figures in NT$ thousands (see the InstitutionalFlow schema comment).
 */
export function institutionalFlowScore(
  foreignNet: number,
  trustNet: number,
  dealerNet: number,
  turnover: number,
): number {
  // Callers MUST gate on `turnover > 0` and drop the component from the
  // weighting when it is not — there is no institutional share of a session
  // nobody traded, and this 50 would be an invented neutral reading, exactly
  // what the flowSource === "none" path exists to avoid. Kept as a defensive
  // floor rather than a throw so a formula unit test cannot divide by zero.
  if (turnover <= 0) return 50;
  const net = foreignNet + trustNet + dealerNet * 0.5;
  return squash(net / turnover, 0.05);
}

/**
 * Relative strength vs. TAIEX. Blends today's spread with the trailing
 * five-session spread so a single strong session does not read the same as a
 * group that has been outperforming all week — spec §2 asks for
 * "Industry return - TAIEX return and/or rolling relative strength", and the
 * blend is what makes the score respond to both.
 *
 * @param dailySpreadPct   industry return − TAIEX return, today, in points
 * @param rollingSpreadPct industry 5-session return − TAIEX 5-session return,
 *                         in points (converted to a per-session average here)
 */
export function relativeStrengthScore(dailySpreadPct: number, rollingSpreadPct: number): number {
  const blended = 0.6 * dailySpreadPct + 0.4 * (rollingSpreadPct / 5);
  return squash(blended, 1.5);
}

// ---------------------------------------------------------------------------
// Total score
// ---------------------------------------------------------------------------

/**
 * Industry Sentiment Score =
 *   Advancing Stock Ratio × 25% + Average Industry Return × 20%
 *   + Volume Expansion × 15% + Breakout Stock Ratio × 15%
 *   + Institutional Flow × 15% + Relative Strength vs TAIEX × 10%
 *
 * All components are 0-100. Weights that do not sum to 1 are normalized, so
 * a partial re-weighting through the API still yields a 0-100 result.
 */
export function computeSentimentScore(components: SentimentComponents, weights: SentimentWeights): number {
  const weightSum =
    weights.advancingRatioWeight +
    weights.averageReturnWeight +
    weights.volumeExpansionWeight +
    weights.breakoutRatioWeight +
    weights.institutionalFlowWeight +
    weights.relativeStrengthWeight;

  const normalizer = weightSum > 0 ? 1 / weightSum : 0;

  const total =
    (components.advancingRatio * weights.advancingRatioWeight +
      components.averageReturn * weights.averageReturnWeight +
      components.volumeExpansion * weights.volumeExpansionWeight +
      components.breakoutRatio * weights.breakoutRatioWeight +
      components.institutionalFlowScore * weights.institutionalFlowWeight +
      components.relativeStrengthScore * weights.relativeStrengthWeight) *
    normalizer;

  return Math.round(clamp(total, 0, 100) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Reading back a stored snapshot
// ---------------------------------------------------------------------------

/** Reads back the `weightsSnapshot` string stored on an
 *  IndustrySentimentSnapshot row. Null when missing or unparseable — callers
 *  must treat that as "unknown", never as zero. */
export function parseSentimentWeightsSnapshot(snapshot: string | null | undefined): SentimentWeights | null {
  return parseWeightRecord(snapshot, SENTIMENT_WEIGHT_FIELDS);
}

/**
 * Whether a sentiment component actually contributed to a stored total.
 *
 * compute-sentiment.ts zeroes `institutionalFlowWeight` on the rows where the
 * session had no usable flow figure, so a zero here means the stored
 * `institutionalFlowScore` is inert filler (the column is NOT NULL and a 0 would
 * read as heavy selling) and must be displayed as 無資料 rather than as a number.
 */
export function sentimentComponentParticipated(
  snapshot: string | null | undefined,
  key: keyof SentimentWeights,
): boolean {
  return weightParticipated(snapshot, SENTIMENT_WEIGHT_FIELDS, key);
}

/** Whether a stored sentiment score rests on too little of its own definition
 *  to be read at face value — see `scoreIsLowConfidence` in scoring.ts. */
export function sentimentIsLowConfidence(snapshot: string | null | undefined): boolean {
  return isLowConfidence(snapshot, SENTIMENT_WEIGHT_FIELDS);
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

export interface SentimentStatusInput {
  score: number;
  /** score today − score at the previous session. 0 when there is no prior. */
  scoreDelta: number;
  /** previousRank − rank. Positive means the industry climbed. */
  rankDelta: number;
  /** Share of members up today, 0-1. */
  advancingShare: number;
  /** Equal-weighted average member return today, in percent. */
  averageReturnPct: number;
  /** Session turnover / trailing 20-session average. */
  volumeRatio: number;
  /** Industry return − TAIEX return today, in points. */
  relativeStrengthPct: number;
}

/**
 * Maps the sentiment reading onto the interpretable labels of spec §6.
 *
 * Rule ORDER encodes the module's UX principle (spec §13): change and
 * acceleration are checked before level, because "this group went from #9 to
 * #1 today" is the more actionable fact than "this group scores 84". Only
 * once nothing is changing dramatically does the classifier fall back to
 * describing the level.
 *
 * 短線過熱 is explicitly NOT bearish (spec §6) — it sits between the bullish
 * labels in severity, saying "this move has run hot", not "this will fall".
 */
export function classifySentimentStatus(input: SentimentStatusInput): SentimentStatus {
  const { score, scoreDelta, rankDelta, advancingShare, averageReturnPct, volumeRatio, relativeStrengthPct } = input;

  // 1. Overheated first, so the "this has already run hot" reading is never
  //    masked by a label that only says the group is strong. A stretched
  //    group is almost always accelerating too, so ordering it second would
  //    make it nearly unreachable — and it is the one label here that carries
  //    a caution. Matches classifyIndustryStatus(), which likewise resolves
  //    "overheated" before any change-based label.
  //
  //    It fires on genuinely extreme short-term return or volume, never on a
  //    high score alone, otherwise every strong group would read as
  //    overheated. The gates are set from what is extreme for an INDUSTRY
  //    AVERAGE rather than for a single stock: a whole group averaging +3% in
  //    one session is a rare day in Taiwan (a strong sector day is +1-2%),
  //    and 2x the trailing volume is the conventional 爆量 threshold.
  //
  //    Per spec §6 this is NOT a bearish label — see SENTIMENT_STATUS_BADGE,
  //    which colours it amber rather than borrowing the down-colour.
  if (score >= 78 && (averageReturnPct >= 3 || volumeRatio >= 2.0)) return "overheated";

  // 2. Then acceleration — among everything not already stretched, the change
  //    IS the signal (spec §13). Ranked above 強勢群聚 so the spec's own
  //    worked example (58 → 84, rank #9 → #1, 8/10 members up) resolves to
  //    加速轉強 rather than to the level-based label.
  if (score >= 55 && (scoreDelta >= 10 || rankDelta >= 5)) return "accelerating";

  // 3. Broad-based strength: high score AND most of the group participating
  //    AND the group beating the index. This is the label that separates
  //    "industry +5%, ten names rising" from "industry +5%, one limit-up".
  if (score >= 70 && advancingShare >= 0.7 && relativeStrengthPct > 0) return "strong_cluster";

  // 4. Its mirror image, at thresholds mirrored about the neutral 50 so a
  //    broadly-weak group is called out as readily as a broadly-strong one.
  if (score <= 30 && advancingShare <= 0.3 && relativeStrengthPct < 0) return "weak_cluster";

  // 5. Deterioration, again as a change rather than a level.
  if (scoreDelta <= -10 || rankDelta <= -5) return "weakening";

  // 6. Level description.
  if (score >= 62) return "bullish";
  if (score >= 54) return "mild_bullish";
  if (score > 46) return "neutral";
  return "mild_bearish";
}

/**
 * Sentiment vs. Heat quadrant (spec §10 Case A-D). Purely descriptive — it
 * names the relationship between two scores and deliberately stops short of
 * suggesting an action.
 */
export type SentimentHeatQuadrant = "mainstream" | "speculative" | "consolidating" | "low_priority";

export function classifyQuadrant(sentimentScore: number, heatScore: number): SentimentHeatQuadrant {
  const hotSentiment = sentimentScore >= 60;
  const hotHeat = heatScore >= 60;
  if (hotSentiment && hotHeat) return "mainstream";
  if (hotSentiment && !hotHeat) return "speculative";
  if (!hotSentiment && hotHeat) return "consolidating";
  return "low_priority";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
