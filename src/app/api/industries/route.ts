import { getIndustryRadar } from "@/lib/queries";
import { getActiveScoreWeights } from "@/lib/score-weights";
import { ok } from "@/lib/api";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const [industries, weights] = await Promise.all([getIndustryRadar(), getActiveScoreWeights()]);
  return ok(industries, { weights, count: industries.length });
}
