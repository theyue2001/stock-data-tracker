import type { AIBriefProvider, DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";
import { MockAIBriefProvider } from "@/lib/ai/mock-provider";
import { OpenAIBriefProvider } from "@/lib/ai/openai-provider";
import { ClaudeBriefProvider } from "@/lib/ai/claude-provider";

const mock = new MockAIBriefProvider();

function resolveProvider(): AIBriefProvider {
  const preferred = (process.env.AI_PROVIDER || "mock").toLowerCase();
  if (preferred === "openai") return new OpenAIBriefProvider();
  if (preferred === "claude") return new ClaudeBriefProvider();
  return mock;
}

/**
 * Generates the daily brief using the configured provider (AI_PROVIDER env
 * var: "openai" | "claude" | "mock", default "mock"). Falls back to the
 * rule-based mock provider if the real provider errors (missing key,
 * network failure, bad response) so the page never breaks.
 */
export async function generateDailyBrief(ctx: DailyBriefContext): Promise<DailyBriefOutput> {
  const provider = resolveProvider();
  if (provider.name === "mock") return provider.generateDailyBrief(ctx);

  try {
    return await provider.generateDailyBrief(ctx);
  } catch (err) {
    console.error(`[ai] ${provider.name} provider failed, falling back to mock:`, err);
    return mock.generateDailyBrief(ctx);
  }
}
