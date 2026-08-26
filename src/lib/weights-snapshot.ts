/**
 * Reading back the `weightsSnapshot` column that IndustryScore and
 * IndustrySentimentSnapshot both carry.
 *
 * Both scoring passes record the weighting a row was ACTUALLY computed with,
 * which is not always the configured one: a component with no input data is
 * dropped by zeroing its weight rather than being scored as a neutral 50. The
 * component column itself still holds 50 — it is NOT NULL and a 0 would read as
 * bearish — so the zeroed weight in the snapshot is the only record that the
 * component did not take part, and the only thing a display site can use to
 * decide between showing a number and showing 無資料.
 *
 * This module is PURE and formula-agnostic on purpose. src/lib/scoring.ts
 * (heat) and src/lib/sentiment.ts (sentiment) are deliberately independent of
 * each other, but they need the same snapshot mechanics, so those mechanics live
 * here instead of in either one.
 */

/** Parses a snapshot into a weight record, requiring every expected key to be
 *  present and numeric. Returns null when it is missing or unparseable —
 *  callers must treat that as "unknown", never as zero. */
export function parseWeightRecord<K extends string>(
  snapshot: string | null | undefined,
  keys: readonly K[],
): Record<K, number> | null {
  if (!snapshot) return null;
  try {
    const parsed = JSON.parse(snapshot) as Partial<Record<K, number>>;
    if (keys.some((k) => typeof parsed[k] !== "number")) return null;
    return parsed as Record<K, number>;
  } catch {
    return null;
  }
}

/**
 * Whether one component actually contributed to a stored total score.
 *
 * Two cases deliberately read the same way. A weight the operator themselves
 * set to zero in the weight config also reports false here — correct as far as
 * the score goes, since a zero-weighted component genuinely drives nothing,
 * even though a UI saying "no data" is a slightly wrong explanation of a
 * deliberate opt-out. And rows written before a weighting change carry the full
 * configured weights, so they report true: their totals really were computed
 * with the component included, and rewriting that history from here would be a
 * lie in the other direction. Re-run the scoring pass to update them.
 */
export function weightParticipated<K extends string>(
  snapshot: string | null | undefined,
  keys: readonly K[],
  key: K,
): boolean {
  const weights = parseWeightRecord(snapshot, keys);
  if (!weights) return true;
  return weights[key] > 0;
}

/**
 * Below this share of the weighting, a total score is reported as 參考性低.
 *
 * 0.6 is chosen against the worst realistic case rather than as a round number:
 * the heat score's two data-gated components are leading indicators (25%) and
 * capital flow (20%). Losing indicators alone leaves 0.75, which is a thinner
 * but still meaningful reading; losing both leaves 0.55, at which point more
 * than two fifths of the definition is absent and the number is no longer the
 * score the UI names it as. The threshold sits between those two so the badge
 * appears exactly in the second case.
 */
export const LOW_CONFIDENCE_PARTICIPATION = 0.6;

/**
 * The share of the weighting that actually took part in a stored score, as a
 * 0-1 figure. Returns null for a snapshot that cannot be read, which callers
 * must treat as "unknown" rather than as low confidence.
 *
 * This is simply the snapshot's weight sum, which works because both weight
 * APIs reject a configured weighting that does not sum to 1.00 (±0.01) — see
 * the PATCH handlers in src/app/api/score-weights and
 * src/app/api/sentiment-weights. So a snapshot summing to 0.55 means 45% of the
 * definition was dropped for want of data, not that the operator rescaled
 * everything.
 */
export function participationShare<K extends string>(
  snapshot: string | null | undefined,
  keys: readonly K[],
): number | null {
  const weights = parseWeightRecord(snapshot, keys);
  if (!weights) return null;
  return keys.reduce((sum, k) => sum + weights[k], 0);
}

/** Whether a stored score rests on too little of its own definition to be read
 *  at face value. False for an unreadable snapshot: unknown is not evidence. */
export function isLowConfidence<K extends string>(
  snapshot: string | null | undefined,
  keys: readonly K[],
): boolean {
  const share = participationShare(snapshot, keys);
  if (share === null) return false;
  return share < LOW_CONFIDENCE_PARTICIPATION;
}
