import { getIndustryMomentum } from "@/lib/sentiment-queries";
import { getActiveSentimentWeights } from "@/lib/sentiment-weights";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Today's Industry Sentiment readings — the same rows the Overview module's
 * 多方 / 空方 / 細產業 tabs render, served straight from the shared query so
 * an API consumer and the UI can never disagree.
 */
export async function GET() {
  const [momentum, weights] = await Promise.all([getIndustryMomentum(), getActiveSentimentWeights()]);
  return ok(momentum, {
    weights,
    industryCount: momentum.industries.length,
    subIndustryCount: momentum.subIndustries.length,
    note: "Industry Sentiment is a short-term breadth reading and is separate from the Industry Heat Score served by /api/industries.",
  });
}
