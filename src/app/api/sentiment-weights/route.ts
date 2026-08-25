import { db } from "@/lib/db";
import { getActiveSentimentWeights } from "@/lib/sentiment-weights";
import { DEFAULT_SENTIMENT_WEIGHTS, SENTIMENT_WEIGHT_FIELDS } from "@/lib/sentiment";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const weights = await getActiveSentimentWeights();
  const sum = SENTIMENT_WEIGHT_FIELDS.reduce((s, f) => s + weights[f], 0);
  return ok(weights, { defaults: DEFAULT_SENTIMENT_WEIGHTS, sum: Math.round(sum * 1000) / 1000 });
}

/**
 * Updates the active Industry Sentiment weighting. Existing snapshots keep
 * the weights they were computed with (weightsSnapshot), so history stays
 * reproducible — re-run the refresh job to recompute today under new weights.
 *
 * Deliberately a separate endpoint from /api/score-weights: retuning the
 * short-term sentiment formula must never silently change the medium-term
 * heat score, or vice versa.
 */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Request body must be valid JSON");
  }

  if (typeof body !== "object" || body === null) return fail("Request body must be a JSON object");
  const input = body as Record<string, unknown>;

  const patch: Record<string, number> = {};
  for (const field of SENTIMENT_WEIGHT_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      return fail(`${field} must be a number between 0 and 1`);
    }
    patch[field] = value;
  }

  if (Object.keys(patch).length === 0) {
    return fail(`Provide at least one of: ${SENTIMENT_WEIGHT_FIELDS.join(", ")}`);
  }

  const current = await db.sentimentWeightConfig.findFirst({ where: { isActive: true } });
  const merged = { ...(current ?? DEFAULT_SENTIMENT_WEIGHTS), ...patch };
  const sum = SENTIMENT_WEIGHT_FIELDS.reduce((s, f) => s + (merged as Record<string, number>)[f], 0);

  // Weights are normalized at scoring time, but a sum far from 1 usually means
  // a client mistake rather than an intentional rescale.
  if (Math.abs(sum - 1) > 0.01) {
    return fail(`Weights must sum to 1.00 (received ${sum.toFixed(3)})`);
  }

  const saved = current
    ? await db.sentimentWeightConfig.update({ where: { id: current.id }, data: patch })
    : await db.sentimentWeightConfig.create({ data: { name: "default", ...merged, isActive: true } });

  return ok(
    {
      advancingRatioWeight: saved.advancingRatioWeight,
      averageReturnWeight: saved.averageReturnWeight,
      volumeExpansionWeight: saved.volumeExpansionWeight,
      breakoutRatioWeight: saved.breakoutRatioWeight,
      institutionalFlowWeight: saved.institutionalFlowWeight,
      relativeStrengthWeight: saved.relativeStrengthWeight,
    },
    { note: "Run POST /api/jobs/refresh to recompute today's sentiment snapshots with the new weights." },
  );
}
