import { db } from "@/lib/db";
import { getActiveScoreWeights } from "@/lib/score-weights";
import { DEFAULT_SCORE_WEIGHTS } from "@/lib/scoring";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

const FIELDS = [
  "fundamentalWeight",
  "leadingIndicatorWeight",
  "capitalFlowWeight",
  "technicalWeight",
  "catalystWeight",
] as const;

export async function GET() {
  const weights = await getActiveScoreWeights();
  const sum = FIELDS.reduce((s, f) => s + weights[f], 0);
  return ok(weights, { defaults: DEFAULT_SCORE_WEIGHTS, sum: Math.round(sum * 1000) / 1000 });
}

/**
 * Updates the active weighting. Existing IndustryScore rows keep the weights
 * they were computed with (weightsSnapshot), so history stays reproducible —
 * re-run the backfill if you want past scores recomputed under new weights.
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
  for (const field of FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      return fail(`${field} must be a number between 0 and 1`);
    }
    patch[field] = value;
  }

  if (Object.keys(patch).length === 0) {
    return fail(`Provide at least one of: ${FIELDS.join(", ")}`);
  }

  const current = await db.scoreWeightConfig.findFirst({ where: { isActive: true } });
  const merged = { ...(current ?? DEFAULT_SCORE_WEIGHTS), ...patch };
  const sum = FIELDS.reduce((s, f) => s + (merged as Record<string, number>)[f], 0);

  // Weights are normalized at scoring time, but a sum far from 1 usually means
  // a client mistake rather than an intentional rescale.
  if (Math.abs(sum - 1) > 0.01) {
    return fail(`Weights must sum to 1.00 (received ${sum.toFixed(3)})`);
  }

  const saved = current
    ? await db.scoreWeightConfig.update({ where: { id: current.id }, data: patch })
    : await db.scoreWeightConfig.create({ data: { name: "default", ...merged, isActive: true } });

  return ok(
    {
      fundamentalWeight: saved.fundamentalWeight,
      leadingIndicatorWeight: saved.leadingIndicatorWeight,
      capitalFlowWeight: saved.capitalFlowWeight,
      technicalWeight: saved.technicalWeight,
      catalystWeight: saved.catalystWeight,
    },
    { note: "Run POST /api/jobs/refresh to recompute today's scores with the new weights." },
  );
}
