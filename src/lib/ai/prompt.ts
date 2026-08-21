import type { DailyBriefContext } from "@/lib/ai/types";

export const BRIEF_JSON_SHAPE = `{
  "marketSummary": string,
  "strongestIndustries": string[],
  "weakestIndustries": string[],
  "capitalRotation": string,
  "leadingIndicatorChanges": string[],
  "institutionalActivity": string,
  "emergingThemes": string[],
  "stocksToWatch": string[],
  "overheatedThemes": string[],
  "keyRisks": string[],
  "tomorrowWatchlist": string[],
  "knownFacts": string[],
  "reasonableInference": string[],
  "uncertainty": string[]
}`;

export const SYSTEM_PROMPT = `You are an equity research assistant for a Taiwan-market industry-rotation dashboard.
Write a structured daily brief using ONLY the numeric facts given in the user message context — never invent
prices, percentages, or events not present in the data. Separate your output into:
- Known Facts: directly observed from the provided data.
- Reasonable Inference: interpretation across multiple data points (label it as inference, e.g. "suggests", "may indicate").
- Uncertainty / Risk: what could invalidate the thesis, and limitations of the data.
Never promise or imply investment returns. Never issue direct buy/sell instructions. This is decision-support research, not trading advice.
Respond with ONLY minified JSON matching this exact shape (all string fields, arrays of short strings, no markdown, no commentary):
${BRIEF_JSON_SHAPE}`;

export function buildUserPrompt(ctx: DailyBriefContext): string {
  return `Date: ${ctx.date}\n\nContext data (JSON):\n${JSON.stringify(ctx)}`;
}
