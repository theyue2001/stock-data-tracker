import { ntFlow } from "@/lib/format";
import type { AIBriefProvider, DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";

/**
 * Rule-based, no-LLM fallback. Deterministically composes a brief from the
 * aggregated context so the Daily Brief page is always populated, even
 * with no OPENAI_API_KEY / ANTHROPIC_API_KEY configured. This is the
 * default provider for the MVP.
 */
export class MockAIBriefProvider implements AIBriefProvider {
  name = "mock" as const;

  async generateDailyBrief(ctx: DailyBriefContext): Promise<DailyBriefOutput> {
    const sorted = [...ctx.industries].sort((a, b) => b.scoreToday - a.scoreToday);
    const strongest = sorted.slice(0, 4);
    const weakest = [...sorted].reverse().slice(0, 3);
    const overheated = ctx.industries.filter((i) => i.status === "overheated");
    const accelerating = ctx.industries.filter((i) => i.status === "accelerating" || i.status === "strengthening");

    const marketSummary = ctx.marketStatus
      ? `${ctx.marketStatus.index} closed at ${ctx.marketStatus.close.toLocaleString()} (${
          ctx.marketStatus.changePct >= 0 ? "+" : ""
        }${ctx.marketStatus.changePct.toFixed(2)}%), with ${ctx.marketStatus.breadthAdvancers} advancers vs. ${
          ctx.marketStatus.breadthDecliners
        } decliners. Foreign investors were ${
          ctx.marketStatus.foreignNet >= 0 ? "net buyers" : "net sellers"
        } (${ntFlow(ctx.marketStatus.foreignNet)}) and investment trusts were ${
          ctx.marketStatus.trustNet >= 0 ? "net buyers" : "net sellers"
        } (${ntFlow(ctx.marketStatus.trustNet)}).`
      : "Market status data is unavailable for today.";

    const strongestIndustries = strongest.map(
      (i) => `${i.name}: heat score ${i.scoreToday.toFixed(1)} (${i.status}), up from ${i.scoreWeekAgo.toFixed(1)} a week ago.`,
    );
    const weakestIndustries = weakest.map(
      (i) => `${i.name}: heat score ${i.scoreToday.toFixed(1)} (${i.status}), vs. ${i.scoreWeekAgo.toFixed(1)} a week ago.`,
    );

    const capitalRotation = ctx.topFlows.length
      ? `Capital is concentrating in ${ctx.topFlows
          .slice(0, 3)
          .map((f) => f.industryName)
          .join(", ")}, with the largest combined foreign + trust net buying this session. ${
          ctx.topFlows.filter((f) => f.breakoutCount >= 3).length
        } industry group(s) show 3+ stocks breaking out together, a sign of broadening participation rather than a single-stock move.`
      : "No significant capital rotation signal detected today.";

    const leadingIndicatorChanges = ctx.indicatorChanges.slice(0, 6).map((c) => {
      const dir = (c.pctChange ?? 0) >= 0 ? "rose" : "fell";
      return `${c.industryName} — ${c.indicatorName} ${dir} ${Math.abs(c.pctChange ?? 0).toFixed(1)}% to ${c.value.toFixed(2)}${
        c.unit ? ` ${c.unit}` : ""
      }.`;
    });

    const topForeign = ctx.topFlows[0]?.industryName;
    const topTrust = [...ctx.topFlows].sort((a, b) => b.trustNet - a.trustNet)[0]?.industryName;
    const biggestSeller = [...ctx.topFlows].sort((a, b) => a.foreignNet - b.foreignNet)[0];

    const institutionalActivity = ctx.topFlows.length
      ? [
          topForeign && topTrust && topForeign === topTrust
            ? `Both foreign investors and investment trusts concentrated their net buying in ${topForeign}, a rare alignment that usually marks the market's clearest current preference.`
            : `Foreign investors added the most net exposure to ${topForeign ?? "no single industry"}, while investment trusts were most active in ${topTrust ?? "no single industry"}.`,
          biggestSeller && biggestSeller.foreignNet < 0
            ? `The heaviest foreign selling was in ${biggestSeller.industryName}.`
            : "No industry saw material foreign net selling.",
        ].join(" ")
      : "No standout institutional activity today.";

    const emergingThemes = accelerating
      .slice(0, 3)
      .map((i) => `${i.name} is showing early acceleration in both capital flow and leading indicators — worth monitoring before it becomes consensus.`);

    const stocksToWatch = ctx.watchedStocks.length
      ? ctx.watchedStocks.slice(0, 8)
      : ["No stocks currently on the watchlist — add tickers from the Stock Radar to personalize this section."];

    const overheatedThemes = overheated.map(
      (i) => `${i.name} has an elevated heat score (${i.scoreToday.toFixed(1)}) — much of the good news may already be priced in.`,
    );

    const keyRisks = [
      "Heat scores are derived from a limited, MVP-stage indicator set — treat as directional, not precise.",
      ...ctx.alerts
        .filter((a) => a.importance === "high")
        .slice(0, 3)
        .map((a) => `${a.title}: ${a.explanation}`),
    ];

    const tomorrowWatchlist = [
      ...strongest.slice(0, 2).map((i) => `Watch for continued capital-flow confirmation in ${i.name}.`),
      ...(overheated.length ? [`Watch for reversal signs in ${overheated.map((i) => i.name).join(", ")} given overheated readings.`] : []),
      ...ctx.watchedIndustries
        .filter((name) => !strongest.some((s) => s.name === name))
        .slice(0, 2)
        .map((name) => `${name} is on your watchlist — check whether its leading indicators confirmed today's move.`),
    ];

    const knownFacts = [
      marketSummary,
      ...leadingIndicatorChanges.slice(0, 3),
      ...ctx.catalysts.slice(0, 3).map((c) => `${c.industryName ?? "Market"}: ${c.title}`),
    ];

    const reasonableInference = [
      capitalRotation,
      ...emergingThemes,
      "Industries showing simultaneous improvement across capital flow AND leading indicators tend to precede broader price recognition — this is an inference from correlated signals, not a guarantee.",
    ];

    const uncertainty = [
      "This brief is generated from a rule-based mock-data pipeline for the MVP; indicator coverage and history length are limited.",
      "Institutional flow and heat scores can reverse quickly; a single-day reading is not a trend.",
      "This is investment research support, not a recommendation to buy or sell, and does not promise any return.",
    ];

    return {
      marketSummary,
      strongestIndustries,
      weakestIndustries,
      capitalRotation,
      leadingIndicatorChanges,
      institutionalActivity,
      emergingThemes: emergingThemes.length ? emergingThemes : ["No clearly emerging theme stood out today."],
      stocksToWatch,
      overheatedThemes: overheatedThemes.length ? overheatedThemes : ["No industries are currently flagged as overheated."],
      keyRisks,
      tomorrowWatchlist: tomorrowWatchlist.length ? tomorrowWatchlist : ["No specific follow-ups flagged for tomorrow."],
      knownFacts,
      reasonableInference,
      uncertainty,
      generatedBy: "mock",
    };
  }
}
