import { getIndustryRadar } from "@/lib/queries";
import { getActiveScoreWeights } from "@/lib/score-weights";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const [industries, weights] = await Promise.all([getIndustryRadar(), getActiveScoreWeights()]);
  return ok(industries, { weights, count: industries.length });
}
