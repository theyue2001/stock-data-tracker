import { db } from "@/lib/db";
import { DEFAULT_SCORE_WEIGHTS } from "@/lib/scoring";
import type { ScoreWeights } from "@/lib/types";

/** Reads the active, configurable heat-score weighting from the database. */
export async function getActiveScoreWeights(): Promise<ScoreWeights> {
  const config = await db.scoreWeightConfig.findFirst({ where: { isActive: true } });
  if (!config) return DEFAULT_SCORE_WEIGHTS;
  return {
    fundamentalWeight: config.fundamentalWeight,
    leadingIndicatorWeight: config.leadingIndicatorWeight,
    capitalFlowWeight: config.capitalFlowWeight,
    technicalWeight: config.technicalWeight,
    catalystWeight: config.catalystWeight,
  };
}
