import type { AIBriefProvider, DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";

/**
 * AI_TIMEOUT_MS (default 60 s) bounds the whole request, body included. A hung
 * provider would otherwise hold the daily pipeline — and its lock — until the
 * platform kills the function; a timeout is just another provider failure, so
 * generateDailyBrief falls back to the mock composer as it does for any other.
 */
function timeoutMs(): number {
  const ms = Number(process.env.AI_TIMEOUT_MS ?? 60000);
  return Number.isInteger(ms) && ms > 0 ? ms : 60000;
}

/** Thin fetch-based adapter — no SDK dependency required for the MVP. */
export class OpenAIBriefProvider implements AIBriefProvider {
  name = "openai" as const;

  async generateDailyBrief(ctx: DailyBriefContext): Promise<DailyBriefOutput> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs()),
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
