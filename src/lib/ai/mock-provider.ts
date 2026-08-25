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

    // --- Short-term sentiment (spec §12) ---------------------------------
    // Composed from the already-ranked highlight lists rather than re-sorting
    // here, so the brief, the API and the Overview module can never disagree
    // about which group rose fastest.
    const sent = ctx.sentiment;
    const sentimentSummary = sent.industries.length
      ? `Across ${sent.industries.length} industries, ${sent.industries.filter((i) => i.sentimentScore >= 50).length} closed with a bullish short-term sentiment reading (score ≥ 50) and ${
          sent.industries.filter((i) => i.sentimentScore < 50).length
        } bearish. ${
          sent.fastestRising.length
            ? `The sharpest single-session improvement was ${sent.fastestRising[0]}`
            : "No industry improved its sentiment score today."
        } Sentiment measures today's breadth and participation only; it is a separate reading from the medium-term heat score.`
      : "No industry sentiment snapshot is available for today.";

    const sentimentRising = sent.fastestRising.length
      ? sent.fastestRising
      : ["No industry raised its sentiment score versus the previous session."];
    const sentimentFalling = sent.fastestFalling.length
      ? sent.fastestFalling
      : ["No industry lowered its sentiment score versus the previous session."];
    const sentimentRankJumps = sent.biggestRankJumps.length
      ? sent.biggestRankJumps
      : ["No industry climbed the sentiment ranking today."];
    const sentimentStrongClusters = sent.strongClusters.length
      ? sent.strongClusters
      : ["No industry currently shows broad-based clustered strength."];
    const sentimentOverheated = sent.overheated.length
      ? sent.overheated
      : ["No industry shows an overheated short-term reading. Note that overheated describes an extended move, not a bearish call."];

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

    // Sentiment high / heat low is the spec §10 Case B signature: the market
    // is moving a group the medium-term score has not caught up to. That is
    // exactly the "before it becomes obvious" case the module exists for, so
    // it belongs in emerging themes rather than being left for the reader to
    // spot across two tables.
    const earlyMovers = sent.industries
      .filter((i) => i.sentimentScore >= 65 && i.heatScore < 60 && i.rankDelta > 0)
      .slice(0, 3)
      .map(
        (i) =>
          `${i.name}: short-term sentiment ${i.sentimentScore.toFixed(0)} against a medium-term heat score of ${i.heatScore.toFixed(
            0,
          )}, ranking ${i.previousRank !== null ? `#${i.previousRank} → #${i.rank}` : `#${i.rank}`}. Short-term participation is running ahead of the slower fundamental signals — theme-driven rather than fundamentally confirmed, on this data.`,
      );

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
      ...sentimentRising.slice(0, 2),
      ...sentimentRankJumps.slice(0, 1),
      ...leadingIndicatorChanges.slice(0, 3),
      ...ctx.catalysts.slice(0, 3).map((c) => `${c.industryName ?? "Market"}: ${c.title}`),
    ];

    const reasonableInference = [
      capitalRotation,
      ...emergingThemes,
      ...earlyMovers,
      "Industries showing simultaneous improvement across capital flow AND leading indicators tend to precede broader price recognition — this is an inference from correlated signals, not a guarantee.",
    ];

    const uncertainty = [
      "This brief is generated from a rule-based mock-data pipeline for the MVP; indicator coverage and history length are limited.",
      "Industry sentiment is a single-session breadth reading. A one-day jump in sentiment or ranking is not by itself a trend, and it can reverse the next session.",
      "Institutional flow and heat scores can reverse quickly; a single-day reading is not a trend.",
      "This is investment research support, not a recommendation to buy or sell, and does not promise any return.",
    ];

    return {
      marketSummary,
      sentimentSummary,
      sentimentRising,
      sentimentFalling,
      sentimentRankJumps,
      sentimentStrongClusters,
      sentimentOverheated,
      strongestIndustries,
      weakestIndustries,
      capitalRotation,
      leadingIndicatorChanges,
      institutionalActivity,
      emergingThemes: [...emergingThemes, ...earlyMovers].length
        ? [...emergingThemes, ...earlyMovers]
        : ["No clearly emerging theme stood out today."],
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
