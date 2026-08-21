import type { AIBriefProvider, DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";

/** Thin fetch-based adapter — no SDK dependency required for the MVP. */
export class ClaudeBriefProvider implements AIBriefProvider {
  name = "claude" as const;

  async generateDailyBrief(ctx: DailyBriefContext): Promise<DailyBriefOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(ctx) }],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const text: string | undefined = data.content?.[0]?.text;
    if (!text) throw new Error("Anthropic response missing content");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Anthropic response was not valid JSON");

    const parsed = JSON.parse(jsonMatch[0]);
    return { ...parsed, generatedBy: "claude" };
  }
}
