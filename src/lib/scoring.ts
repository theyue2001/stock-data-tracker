import type { IndustryStatus, ScoreComponents, ScoreWeights } from "@/lib/types";

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
  if (!snapshot) return null;
  try {
    const parsed = JSON.parse(snapshot) as Partial<ScoreWeights>;
    const keys: Array<keyof ScoreWeights> = [
      "fundamentalWeight",
      "leadingIndicatorWeight",
      "capitalFlowWeight",
      "technicalWeight",
      "catalystWeight",
    ];
    if (keys.some((k) => typeof parsed[k] !== "number")) return null;
    return parsed as ScoreWeights;
  } catch {
    return null;
  }
}

/**
 * Whether a component actually contributed to a stored total score.
 *
 * compute-scores.ts zeroes a component's weight for the rows where it had no
 * input data, so a zero in the snapshot means "this component is not part of
 * this score" and the stored component value is inert filler that must not be
 * displayed as a reading.
 *
 * Two cases deliberately read the same way. A weight the operator themselves
 * set to zero in ScoreWeightConfig also reports false here — correct as far as
 * the score goes, since a zero-weighted component genuinely drives nothing,
 * even though a UI saying "no data" is a slightly wrong explanation of a
 * deliberate opt-out. And rows written before the weighting change carry the
 * full configured weights, so they report true: their totals really were
 * computed with the component included, and rewriting that history from here
 * would be a lie in the other direction. Re-run the scoring pass to update
 * them.
 */
export function componentParticipated(snapshot: string | null | undefined, key: keyof ScoreWeights): boolean {
  const weights = parseWeightsSnapshot(snapshot);
  if (!weights) return true;
  return weights[key] > 0;
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
