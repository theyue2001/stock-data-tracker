import { db } from "@/lib/db";
import { DEFAULT_SENTIMENT_WEIGHTS } from "@/lib/sentiment";
import type { SentimentWeights } from "@/lib/types";

/** Reads the active, configurable Industry Sentiment weighting from the
 *  database. Mirrors getActiveScoreWeights() for the heat score — the two
 *  configs are separate rows in separate tables and never share a value. */
export async function getActiveSentimentWeights(): Promise<SentimentWeights> {
  const config = await db.sentimentWeightConfig.findFirst({ where: { isActive: true } });
  if (!config) return DEFAULT_SENTIMENT_WEIGHTS;
  return {
    advancingRatioWeight: config.advancingRatioWeight,
    averageReturnWeight: config.averageReturnWeight,
    volumeExpansionWeight: config.volumeExpansionWeight,
    breakoutRatioWeight: config.breakoutRatioWeight,
    institutionalFlowWeight: config.institutionalFlowWeight,
    relativeStrengthWeight: config.relativeStrengthWeight,
  };
}
