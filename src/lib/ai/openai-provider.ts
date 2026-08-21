import type { AIBriefProvider, DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";

/** Thin fetch-based adapter — no SDK dependency required for the MVP. */
export class OpenAIBriefProvider implements AIBriefProvider {
  name = "openai" as const;

  async generateDailyBrief(ctx: DailyBriefContext): Promise<DailyBriefOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(ctx) },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI response missing content");

    const parsed = JSON.parse(content);
    return { ...parsed, generatedBy: "openai" };
  }
}
