import { db } from "@/lib/db";
import { generateDailyBrief } from "@/lib/ai";
import type { DailyBriefContext } from "@/lib/ai/types";
import { utcDay, utcDayOffset } from "@/lib/dates";

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

  const [marketStatus, industries, catalysts, alerts, watchlist] = await Promise.all([
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

  const brief = await generateDailyBrief(context);

  const saved = await db.dailyBrief.upsert({
    where: { date: today },
    create: {
      date: today,
      marketSummary: brief.marketSummary,
      strongestIndustries: JSON.stringify(brief.strongestIndustries),
      weakestIndustries: JSON.stringify(brief.weakestIndustries),
      capitalRotation: brief.capitalRotation,
      leadingIndicatorChanges: JSON.stringify(brief.leadingIndicatorChanges),
      institutionalActivity: brief.institutionalActivity,
      emergingThemes: JSON.stringify(brief.emergingThemes),
      stocksToWatch: JSON.stringify(brief.stocksToWatch),
      overheatedThemes: JSON.stringify(brief.overheatedThemes),
      keyRisks: JSON.stringify(brief.keyRisks),
      tomorrowWatchlist: JSON.stringify(brief.tomorrowWatchlist),
      knownFacts: JSON.stringify(brief.knownFacts),
      reasonableInference: JSON.stringify(brief.reasonableInference),
      uncertainty: JSON.stringify(brief.uncertainty),
      generatedBy: brief.generatedBy,
    },
    update: {
      marketSummary: brief.marketSummary,
      strongestIndustries: JSON.stringify(brief.strongestIndustries),
      weakestIndustries: JSON.stringify(brief.weakestIndustries),
      capitalRotation: brief.capitalRotation,
      leadingIndicatorChanges: JSON.stringify(brief.leadingIndicatorChanges),
      institutionalActivity: brief.institutionalActivity,
      emergingThemes: JSON.stringify(brief.emergingThemes),
      stocksToWatch: JSON.stringify(brief.stocksToWatch),
      overheatedThemes: JSON.stringify(brief.overheatedThemes),
      keyRisks: JSON.stringify(brief.keyRisks),
      tomorrowWatchlist: JSON.stringify(brief.tomorrowWatchlist),
      knownFacts: JSON.stringify(brief.knownFacts),
      reasonableInference: JSON.stringify(brief.reasonableInference),
      uncertainty: JSON.stringify(brief.uncertainty),
      generatedBy: brief.generatedBy,
    },
  });

  return saved;
}
