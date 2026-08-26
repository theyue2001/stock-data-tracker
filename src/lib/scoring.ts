import type { IndustryStatus, ScoreComponents, ScoreWeights } from "@/lib/types";
import { isLowConfidence, parseWeightRecord, weightParticipated } from "@/lib/weights-snapshot";

// Default weights per spec §6. Never hard-code these into UI — always read
// through ScoreWeightConfig (see src/lib/db-config.ts) and fall back to this
// object only when no config row exists yet.
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  fundamentalWeight: 0.3,
  leadingIndicatorWeight: 0.25,
  capitalFlowWeight: 0.2,
  technicalWeight: 0.15,
  catalystWeight: 0.1,
};

export const SCORE_WEIGHT_FIELDS = [
  "fundamentalWeight",
  "leadingIndicatorWeight",
  "capitalFlowWeight",
  "technicalWeight",
  "catalystWeight",
] as const;

/**
 * Industry Heat Score =
 *   Fundamental × w1 + Leading Indicators × w2 + Capital Flow × w3
 *   + Technical × w4 + Catalyst × w5
 *
 * All component scores are expected on a 0-100 scale. Weights are expected
 * to sum to ~1; if a caller passes weights that don't sum to 1 we normalize
 * so the resulting total score still lands on a 0-100 scale.
 */
export function computeHeatScore(components: ScoreComponents, weights: ScoreWeights): number {
  const weightSum =
    weights.fundamentalWeight +
    weights.leadingIndicatorWeight +
    weights.capitalFlowWeight +
    weights.technicalWeight +
    weights.catalystWeight;

  const normalizer = weightSum > 0 ? 1 / weightSum : 0;

  const total =
    (components.fundamentalScore * weights.fundamentalWeight +
      components.leadingIndicatorScore * weights.leadingIndicatorWeight +
      components.capitalFlowScore * weights.capitalFlowWeight +
      components.technicalScore * weights.technicalWeight +
      components.catalystScore * weights.catalystWeight) *
    normalizer;

  return Math.round(Math.min(100, Math.max(0, total)) * 10) / 10;
}

/** Reads back the `weightsSnapshot` string stored on an IndustryScore row.
 *  Returns null when it is missing or unparseable — callers must treat that as
 *  "unknown", never as zero. */
export function parseWeightsSnapshot(snapshot: string | null | undefined): ScoreWeights | null {
  return parseWeightRecord(snapshot, SCORE_WEIGHT_FIELDS);
}

/**
 * Whether a heat-score component actually contributed to a stored total.
 *
 * compute-scores.ts zeroes a component's weight for the rows where it had no
 * input data, so a zero in the snapshot means "this component is not part of
 * this score" and the stored component value is inert filler that must not be
 * displayed as a reading. Two components are gated this way: leading indicators
 * (no licensed series imported) and capital flow (no T86 print for the session).
 *
 * See `weightParticipated` for how an unreadable snapshot and an
 * operator-zeroed weight are handled.
 */
export function componentParticipated(snapshot: string | null | undefined, key: keyof ScoreWeights): boolean {
  return weightParticipated(snapshot, SCORE_WEIGHT_FIELDS, key);
}

/**
 * Whether a stored heat score rests on too little of its own definition to be
 * read at face value.
 *
 * Both data-gated components can be absent at once — most industries have no
 * indicator series at all, and a missing T86 print drops capital flow for every
 * industry on that session — which leaves the "產業熱度" number computed from
 * fundamentals, technicals and catalysts alone. Renormalizing keeps it on a
 * 0-100 scale, but it is no longer measuring what the label promises, and
 * without a marker that substitution is invisible to the reader.
 */
export function scoreIsLowConfidence(snapshot: string | null | undefined): boolean {
  return isLowConfidence(snapshot, SCORE_WEIGHT_FIELDS);
}

/**
 * Classifies an industry's status from its current score and the
 * week-over-week change. Thresholds are intentionally simple/tunable.
 */
export function classifyIndustryStatus(scoreToday: number, scoreOneWeekAgo: number): IndustryStatus {
  const change = scoreToday - scoreOneWeekAgo;

  if (scoreToday >= 85) return "overheated";
  if (change >= 8) return "accelerating";
  if (change >= 2) return "strengthening";
  if (change <= -3) return "weakening";
  return "neutral";
}

export function scoreChangeTrend(scoreToday: number, scoreOneWeekAgo: number): "up" | "down" | "flat" {
  const diff = scoreToday - scoreOneWeekAgo;
  if (diff > 0.5) return "up";
  if (diff < -0.5) return "down";
  return "flat";
}
