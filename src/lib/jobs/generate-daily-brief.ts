import { db } from "@/lib/db";
import { generateDailyBrief } from "@/lib/ai";
import type { DailyBriefContext, DailyBriefOutput } from "@/lib/ai/types";
import { getIndustryMomentum, getSentimentBriefHighlights, type IndustrySentimentRow } from "@/lib/sentiment-queries";
import { SENTIMENT_STATUS_LABEL } from "@/lib/types";
import { utcDay, utcDayOffset } from "@/lib/dates";

/** Renders one industry's sentiment reading as the single factual sentence
 *  the brief quotes. Shared by all five highlight lists so a group reads
 *  identically wherever it appears. */
function sentimentLine(r: IndustrySentimentRow): string {
  const rank = r.previousRank !== null ? `#${r.previousRank} → #${r.rank}` : `#${r.rank}`;
  const delta = r.scoreDelta > 0 ? `+${r.scoreDelta.toFixed(1)}` : r.scoreDelta.toFixed(1);
  return (
    `${r.name}: sentiment ${r.sentimentScore.toFixed(0)} (${delta} vs. prior session), rank ${rank}, ` +
    `${r.advancingCount}/${r.stockCount} members up, volume ${r.volumeRatio.toFixed(1)}x its 20-session average, ` +
    `relative strength ${r.relativeStrengthPct >= 0 ? "+" : ""}${r.relativeStrengthPct.toFixed(2)}pp vs. TAIEX ` +
    `— ${SENTIMENT_STATUS_LABEL[r.status]}.`
  );
}

/** LLM providers spread whatever JSON they returned. A model that omits a
 *  field would otherwise put `undefined` through JSON.stringify and fail the
 *  write, so every field is defaulted before it reaches the database. */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * Aggregates today's data across industries, indicators, flows, catalysts,
 * and alerts into an AI context, generates the brief, and upserts the
 * DailyBrief row for today. Intended to run once per day (see
 * scripts/run-daily-brief-job.ts for the cron entry point) but is also
 * safe to call on-demand from an API route.
 */
export async function runDailyBriefJob(referenceDate: Date = new Date()) {
  const today = utcDay(referenceDate);
  const weekAgo = utcDayOffset(today, 7);

  const [marketStatus, industries, catalysts, alerts, watchlist, momentum, highlights] = await Promise.all([
    db.marketStatus.findFirst({ where: { date: { lte: today } }, orderBy: { date: "desc" } }),
    db.industry.findMany({
      include: {
        scores: { orderBy: { date: "desc" }, take: 10 },
        flows: { where: { scope: "industry" }, orderBy: { date: "desc" }, take: 1 },
      },
    }),
    db.catalyst.findMany({
      where: { date: { gte: weekAgo } },
      include: { industry: true },
      orderBy: { date: "desc" },
      take: 10,
    }),
    db.alert.findMany({
      where: { timestamp: { gte: weekAgo } },
      include: { industry: true },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    db.watchlistItem.findMany({ include: { industry: true, stock: true } }),
    getIndustryMomentum(),
    getSentimentBriefHighlights(),
  ]);

  const industryContext = industries.map((ind) => {
    const scoreToday = ind.scores[0]?.totalScore ?? 0;
    const scoreWeek = ind.scores.find((s) => s.date <= weekAgo)?.totalScore ?? ind.scores[ind.scores.length - 1]?.totalScore ?? scoreToday;
    return {
      name: ind.name,
      slug: ind.slug,
      scoreToday,
      scoreWeekAgo: scoreWeek,
      status: ind.scores[0]?.status ?? "neutral",
      capitalFlowScore: ind.scores[0]?.capitalFlowScore ?? 0,
      leadingIndicatorScore: ind.scores[0]?.leadingIndicatorScore ?? 0,
    };
  });

  const indicatorRows = await db.indicator.findMany({
    include: { industry: true, values: { orderBy: { date: "desc" }, take: 1 } },
  });

  const indicatorChanges = indicatorRows
    .filter((i) => i.values[0])
    .map((i) => ({
      industryName: i.industry.name,
      indicatorName: i.name,
      value: i.values[0].value,
      previousValue: i.values[0].previousValue,
      pctChange: i.values[0].pctChange,
      unit: i.unit,
    }))
    .sort((a, b) => Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0));

  const topFlows = industries
    .map((ind) => ({
      industryName: ind.name,
      foreignNet: ind.flows[0]?.foreignNet ?? 0,
      trustNet: ind.flows[0]?.trustNet ?? 0,
      breakoutCount: ind.flows[0]?.breakoutCount ?? 0,
    }))
    .sort((a, b) => b.foreignNet + b.trustNet - (a.foreignNet + a.trustNet));

  const context: DailyBriefContext = {
    date: today.toISOString().slice(0, 10),
    marketStatus: marketStatus
      ? {
          index: marketStatus.index,
          close: marketStatus.close,
          changePct: marketStatus.changePct,
          breadthAdvancers: marketStatus.breadthAdvancers,
          breadthDecliners: marketStatus.breadthDecliners,
          foreignNet: marketStatus.foreignNet,
          trustNet: marketStatus.trustNet,
        }
      : null,
    industries: industryContext,
    indicatorChanges,
    topFlows,
    sentiment: {
      date: momentum.date,
      industries: momentum.industries.map((r) => ({
        name: r.name,
        slug: r.slug,
        sentimentScore: r.sentimentScore,
        scoreDelta: r.scoreDelta,
        rank: r.rank,
        previousRank: r.previousRank,
        rankDelta: r.rankDelta,
        status: r.status,
        advancingCount: r.advancingCount,
        decliningCount: r.decliningCount,
        stockCount: r.stockCount,
        volumeRatio: r.volumeRatio,
        relativeStrengthPct: r.relativeStrengthPct,
        foreignNet: r.foreignNet,
        trustNet: r.trustNet,
        heatScore: r.heatScore,
      })),
      fastestRising: highlights.fastestRising.map(sentimentLine),
      fastestFalling: highlights.fastestFalling.map(sentimentLine),
      biggestRankJumps: highlights.biggestRankJumps.map(sentimentLine),
      strongClusters: highlights.strongClusters.map(sentimentLine),
      overheated: highlights.overheated.map(sentimentLine),
    },
    catalysts: catalysts.map((c) => ({ title: c.title, industryName: c.industry?.name ?? null, importance: c.importance })),
    alerts: alerts.map((a) => ({
      title: a.title,
      industryName: a.industry?.name ?? null,
      importance: a.importance,
      explanation: a.explanation,
    })),
    watchedStocks: watchlist
      .filter((w) => w.itemType === "stock" && w.stock)
      .map((w) => `${w.stock!.ticker} ${w.stock!.name}`),
    watchedIndustries: watchlist.filter((w) => w.itemType === "industry" && w.industry).map((w) => w.industry!.name),
  };

  const brief: DailyBriefOutput = await generateDailyBrief(context);

  // One field map, applied identically to create and update, so the two can
  // never drift apart as the brief grows fields.
  const fields = {
    marketSummary: str(brief.marketSummary),
    sentimentSummary: str(brief.sentimentSummary),
    sentimentRising: JSON.stringify(arr(brief.sentimentRising)),
    sentimentFalling: JSON.stringify(arr(brief.sentimentFalling)),
    sentimentRankJumps: JSON.stringify(arr(brief.sentimentRankJumps)),
    sentimentStrongClusters: JSON.stringify(arr(brief.sentimentStrongClusters)),
    sentimentOverheated: JSON.stringify(arr(brief.sentimentOverheated)),
    strongestIndustries: JSON.stringify(arr(brief.strongestIndustries)),
    weakestIndustries: JSON.stringify(arr(brief.weakestIndustries)),
    capitalRotation: str(brief.capitalRotation),
    leadingIndicatorChanges: JSON.stringify(arr(brief.leadingIndicatorChanges)),
    institutionalActivity: str(brief.institutionalActivity),
    emergingThemes: JSON.stringify(arr(brief.emergingThemes)),
    stocksToWatch: JSON.stringify(arr(brief.stocksToWatch)),
    overheatedThemes: JSON.stringify(arr(brief.overheatedThemes)),
    keyRisks: JSON.stringify(arr(brief.keyRisks)),
    tomorrowWatchlist: JSON.stringify(arr(brief.tomorrowWatchlist)),
    knownFacts: JSON.stringify(arr(brief.knownFacts)),
    reasonableInference: JSON.stringify(arr(brief.reasonableInference)),
    uncertainty: JSON.stringify(arr(brief.uncertainty)),
    generatedBy: brief.generatedBy,
  };

  const saved = await db.dailyBrief.upsert({
    where: { date: today },
    create: { date: today, ...fields },
    update: fields,
  });

  return saved;
}
