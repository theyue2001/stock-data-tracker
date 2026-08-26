import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { utcDay, utcDayOffset } from "@/lib/dates";
import { componentParticipated, scoreChangeTrend } from "@/lib/scoring";
import type { IndustryStatus, RiskLevel, StockStatus, TechnicalTrend, ValuationPosition } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared view models — the shapes the UI actually renders. Keeping these
// separate from the Prisma row types means the pages don't depend on the
// storage schema, so collectors can later move out of Next.js entirely.
// ---------------------------------------------------------------------------

export interface IndustryRadarRow {
  id: string;
  slug: string;
  name: string;
  nameZh: string | null;
  status: IndustryStatus;
  riskLevel: RiskLevel;
  cyclePosition: string;
  scoreToday: number;
  scoreWeekAgo: number;
  scoreChange: number;
  trend: "up" | "down" | "flat";
  components: {
    fundamental: number;
    /** null when the industry had no usable indicator series, in which case the
     *  component was dropped from the weighting rather than scored as neutral
     *  (see compute-scores.ts). Nullable so no display site can silently render
     *  the inert stored 50 as a real reading. */
    leadingIndicator: number | null;
    capitalFlow: number;
    technical: number;
    catalyst: number;
  };
  dailyChangePct: number;
  weeklyChangePct: number;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  turnover: number;
  breakoutCount: number;
  stockCount: number;
  majorCatalyst: string | null;
  majorRisk: string | null;
  sparkline: number[];
}

export interface StockRadarRow {
  id: string;
  ticker: string;
  name: string;
  nameZh: string | null;
  industryName: string;
  industrySlug: string;
  status: StockStatus;
  price: number;
  changePct: number;
  volume: number;
  foreignNet: number;
  trustNet: number;
  /** Consecutive sessions (within the last 5) foreign net has been on the
   *  same side as today — positive = buy streak, negative = sell streak. */
  foreignStreak: number;
  revenueYoy: number | null;
  revenueMomChangePct: number | null;
  /** Year-to-date basic EPS as filed (t187ap14 is cumulative from January and
   *  resets at Q1), NOT a single quarter. Stored under periodType "ytd_eps";
   *  every display site says 累計. */
  eps: number | null;
  technicalTrend: TechnicalTrend;
  relativeStrength: number | null;
  valuationPosition: ValuationPosition;
  mainCatalyst: string | null;
  mainRisk: string | null;
  sparkline: number[];
}

// ---------------------------------------------------------------------------

export async function getMarketStatus() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const [latest, prior] = await db.marketStatus.findMany({ orderBy: { date: "desc" }, take: 2 });
  if (!latest) return null;

  const history = await db.marketStatus.findMany({ orderBy: { date: "desc" }, take: 30 });

  // "vs. 5-day average turnover" — the prior 5 sessions, excluding today.
  const prior5 = history.slice(1, 6);
  const avgVolume5d = prior5.length ? prior5.reduce((sum, h) => sum + h.volume, 0) / prior5.length : latest.volume;
  const volumeVs5dAvgPct = avgVolume5d > 0 ? Math.round(((latest.volume - avgVolume5d) / avgVolume5d) * 1000) / 10 : 0;

  // The index close is always fetched, but the breadth/institutional-flow
  // bundle is a separate report that can miss a run. Rather than render that
  // day's defaulted 0 as "flat", fall back to the last session that actually
  // reported it — see hasMarketStatusDetail.
  const detail = history.find(hasMarketStatusDetail) ?? latest;
  const detailStale = detail.date.getTime() !== latest.date.getTime();

  return {
    date: latest.date,
    index: latest.index,
    close: latest.close,
    change: latest.change,
    changePct: latest.changePct,
    volume: latest.volume,
    volumeVs5dAvgPct,
    advancers: detail.breadthAdvancers,
    decliners: detail.breadthDecliners,
    foreignNet: detail.foreignNet,
    trustNet: detail.trustNet,
    dealerNet: detail.dealerNet,
    marginChange: detail.marginChange,
    /** Session the breadth/flow figures above actually belong to — differs
     *  from `date` only when today's bundle wasn't fetched. */
    detailDate: detail.date.toISOString().slice(0, 10),
    detailStale,
    priorClose: prior?.close ?? latest.close,
    isMock: latest.isMock,
    sparkline: history.reverse().map((h) => h.close),
  };
}

export async function getIndustryRadar(): Promise<IndustryRadarRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const today = utcDay();
  const weekAgo = utcDayOffset(today, 7);

  const industries = await db.industry.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      scores: { orderBy: { date: "desc" }, take: 30 },
      flows: { where: { scope: "industry" }, orderBy: { date: "desc" }, take: 1 },
      catalysts: { orderBy: { date: "desc" }, take: 1 },
      stocks: { include: { marketData: { orderBy: { date: "desc" }, take: 6 } } },
    },
  });

  return industries.map((ind) => {
    const latest = ind.scores[0];
    const weekAgoScore = ind.scores.find((s) => s.date.getTime() <= weekAgo.getTime()) ?? ind.scores[ind.scores.length - 1];
    const scoreToday = latest?.totalScore ?? 0;
    const scoreWeekAgo = weekAgoScore?.totalScore ?? scoreToday;

    // Industry price change = equal-weighted average of member stocks.
    const dailyChanges = ind.stocks.map((s) => s.marketData[0]?.changePct ?? 0);
    const dailyChangePct = avg(dailyChanges);

    const weeklyChanges = ind.stocks.map((s) => {
      const md = s.marketData;
      if (md.length < 6) return 0;
      return ((md[0].close - md[5].close) / md[5].close) * 100;
    });

    const flow = ind.flows[0];

    return {
      id: ind.id,
      slug: ind.slug,
      name: ind.name,
      nameZh: ind.nameZh,
      status: (latest?.status ?? "neutral") as IndustryStatus,
      riskLevel: ind.riskLevel as RiskLevel,
      cyclePosition: ind.cyclePosition,
      scoreToday,
      scoreWeekAgo,
      scoreChange: Math.round((scoreToday - scoreWeekAgo) * 10) / 10,
      trend: scoreChangeTrend(scoreToday, scoreWeekAgo),
      components: {
        fundamental: latest?.fundamentalScore ?? 0,
        leadingIndicator: componentParticipated(latest?.weightsSnapshot, "leadingIndicatorWeight")
          ? latest?.leadingIndicatorScore ?? 0
          : null,
        capitalFlow: latest?.capitalFlowScore ?? 0,
        technical: latest?.technicalScore ?? 0,
        catalyst: latest?.catalystScore ?? 0,
      },
      dailyChangePct: round2(dailyChangePct),
      weeklyChangePct: round2(avg(weeklyChanges)),
      foreignNet: flow?.foreignNet ?? 0,
      trustNet: flow?.trustNet ?? 0,
      dealerNet: flow?.dealerNet ?? 0,
      turnover: flow?.turnover ?? 0,
      breakoutCount: flow?.breakoutCount ?? 0,
      stockCount: ind.stocks.length,
      majorCatalyst: ind.catalysts[0]?.title ?? null,
      majorRisk: ind.primaryRisk,
      sparkline: [...ind.scores].reverse().map((s) => s.totalScore),
    };
  });
}

/** Slugs for `generateStaticParams` on /industries/[slug], so each detail page
 *  is prerendered per industry instead of blocking on `params` at request
 *  time. Sorted the same way as the radar list. */
export async function getIndustrySlugs(): Promise<string[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const rows = await db.industry.findMany({ orderBy: { sortOrder: "asc" }, select: { slug: true } });
  return rows.map((r) => r.slug);
}

export async function getIndustryDetail(slug: string) {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const today = utcDay();
  const weekAgo = utcDayOffset(today, 7);

  const industry = await db.industry.findUnique({
    where: { slug },
    include: {
      scores: { orderBy: { date: "desc" }, take: 30 },
      indicators: {
        orderBy: { sortOrder: "asc" },
        include: {
          values: { orderBy: { date: "desc" }, take: 16, include: { dataSource: true } },
        },
      },
      catalysts: { orderBy: { date: "desc" } },
      flows: { where: { scope: "industry" }, orderBy: { date: "desc" }, take: 21 },
      alerts: { orderBy: { timestamp: "desc" }, take: 20, include: { stocks: { include: { stock: true } } } },
      stocks: {
        include: {
          marketData: { orderBy: { date: "desc" }, take: 30 },
          flows: { where: { scope: "stock" }, orderBy: { date: "desc" }, take: 5 },
          fundamentals: { orderBy: { period: "desc" } },
        },
      },
    },
  });

  if (!industry) return null;

  const latest = industry.scores[0];
  const weekAgoScore = industry.scores.find((s) => s.date.getTime() <= weekAgo.getTime()) ?? industry.scores[industry.scores.length - 1];

  const stocks: StockRadarRow[] = industry.stocks.map((s) => toStockRow(s, industry.nameZh ?? industry.name, industry.slug));

  return {
    id: industry.id,
    slug: industry.slug,
    name: industry.name,
    nameZh: industry.nameZh,
    description: industry.description,
    thesis: industry.thesis,
    primaryRisk: industry.primaryRisk,
    cyclePosition: industry.cyclePosition,
    riskLevel: industry.riskLevel as RiskLevel,
    status: (latest?.status ?? "neutral") as IndustryStatus,
    scoreToday: latest?.totalScore ?? 0,
    scoreWeekAgo: weekAgoScore?.totalScore ?? 0,
    components: {
      fundamental: latest?.fundamentalScore ?? 0,
      leadingIndicator: componentParticipated(latest?.weightsSnapshot, "leadingIndicatorWeight")
        ? latest?.leadingIndicatorScore ?? 0
        : null,
      capitalFlow: latest?.capitalFlowScore ?? 0,
      technical: latest?.technicalScore ?? 0,
      catalyst: latest?.catalystScore ?? 0,
    },
    weightsSnapshot: latest?.weightsSnapshot ?? null,
    scoreHistory: [...industry.scores].reverse().map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      total: s.totalScore,
      fundamental: s.fundamentalScore,
      leadingIndicator: componentParticipated(s.weightsSnapshot, "leadingIndicatorWeight")
        ? s.leadingIndicatorScore
        : null,
      capitalFlow: s.capitalFlowScore,
      technical: s.technicalScore,
      catalyst: s.catalystScore,
    })),
    indicators: industry.indicators.map((ind) => {
      const vals = [...ind.values].reverse();
      const newest = ind.values[0];
      return {
        id: ind.id,
        key: ind.key,
        name: ind.name,
        unit: ind.unit,
        description: ind.description,
        frequency: ind.frequency,
        higherIsBetter: ind.higherIsBetter,
        value: newest?.value ?? null,
        previousValue: newest?.previousValue ?? null,
        pctChange: newest?.pctChange ?? null,
        date: newest?.date.toISOString().slice(0, 10) ?? null,
        dataTimestamp: newest?.dataTimestamp.toISOString() ?? null,
        sourceName: newest?.dataSource?.name ?? null,
        sourceUrl: newest?.sourceUrl ?? null,
        isMock: newest?.isMock ?? true,
        history: vals.map((v) => ({ date: v.date.toISOString().slice(0, 10), value: v.value })),
      };
    }),
    catalysts: industry.catalysts.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      date: c.date.toISOString().slice(0, 10),
      importance: c.importance,
      source: c.source,
      sourceUrl: c.sourceUrl,
    })),
    flowHistory: [...industry.flows].reverse().map((f) => ({
      date: f.date.toISOString().slice(0, 10),
      foreignNet: f.foreignNet,
      trustNet: f.trustNet,
      dealerNet: f.dealerNet,
      turnover: f.turnover,
      breakoutCount: f.breakoutCount,
    })),
    alerts: industry.alerts.map(toAlertRow),
    stocks,
  };
}

export async function getStockRadar(): Promise<StockRadarRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const stocks = await db.stock.findMany({
    include: {
      industry: true,
      marketData: { orderBy: { date: "desc" }, take: 30 },
      flows: { where: { scope: "stock" }, orderBy: { date: "desc" }, take: 5 },
      fundamentals: { orderBy: { period: "desc" } },
    },
    orderBy: [{ industry: { sortOrder: "asc" } }, { ticker: "asc" }],
  });

  return stocks.map((s) => toStockRow(s, s.industry.nameZh ?? s.industry.name, s.industry.slug));
}

export async function getCapitalFlow() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const today = utcDay();

  const [industries, marketFlows, alerts] = await Promise.all([
    db.industry.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        flows: { where: { scope: "industry" }, orderBy: { date: "desc" }, take: 10 },
        scores: { orderBy: { date: "desc" }, take: 1 },
        stocks: {
          include: {
            // 21 sessions so volume expansion can be measured against the
            // stock's own trailing average rather than a provider-supplied
            // figure that need not agree with the price data.
            marketData: { orderBy: { date: "desc" }, take: 21 },
            flows: { where: { scope: "stock" }, orderBy: { date: "desc" }, take: 5 },
          },
        },
      },
    }),
    db.marketStatus.findMany({ orderBy: { date: "desc" }, take: 20 }),
    db.alert.findMany({
      where: {
        ruleKey: { in: ["foreign_buy_streak", "turnover_spike", "breakout_cluster"] },
        timestamp: { gte: utcDayOffset(today, 3) },
      },
      include: { industry: true, stocks: { include: { stock: true } } },
      orderBy: { timestamp: "desc" },
    }),
  ]);

  const industryFlows = industries.map((ind) => {
    const f = ind.flows[0];
    const foreignStreak = countStreak(ind.flows, (x) => x.foreignNet > 0);
    const trustStreak = countStreak(ind.flows, (x) => x.trustNet > 0);
    const risingStocks = ind.stocks.filter((s) => (s.marketData[0]?.changePct ?? 0) > 0);
    // Volume expansion = latest session's volume vs. the stock's own trailing
    // 20-session average, so it is verifiable from the same price series the
    // rest of the page shows.
    const volumeExpanding = ind.stocks.filter((s) => {
      const [latest, ...prior] = s.marketData;
      if (!latest || prior.length < 5) return false;
      const avgVolume = prior.reduce((sum, m) => sum + m.volume, 0) / prior.length;
      return avgVolume > 0 && latest.volume > avgVolume * 1.2;
    });

    return {
      id: ind.id,
      slug: ind.slug,
      name: ind.name,
      nameZh: ind.nameZh,
      heatScore: ind.scores[0]?.totalScore ?? 0,
      foreignNet: f?.foreignNet ?? 0,
      trustNet: f?.trustNet ?? 0,
      dealerNet: f?.dealerNet ?? 0,
      marginChange: f?.marginChange ?? 0,
      turnover: f?.turnover ?? 0,
      volumeChangePct: f?.volumeChangePct ?? 0,
      breakoutCount: f?.breakoutCount ?? 0,
      foreignStreak,
      trustStreak,
      stockCount: ind.stocks.length,
      risingCount: risingStocks.length,
      volumeExpandingCount: volumeExpanding.length,
      history: [...ind.flows].reverse().map((x) => ({
        date: x.date.toISOString().slice(0, 10),
        foreignNet: x.foreignNet,
        trustNet: x.trustNet,
      })),
      // Group-strength detection (spec §4): several names in one industry
      // rising on expanding volume while institutions accumulate.
      groupStrength:
        risingStocks.length >= 3 && volumeExpanding.length >= 2 && (f?.foreignNet ?? 0) > 0
          ? {
              risingCount: risingStocks.length,
              volumeExpandingCount: volumeExpanding.length,
              tickers: risingStocks.map((s) => s.ticker),
            }
          : null,
    };
  });

  // Same fallback as getMarketStatus: don't render a day the bundle wasn't
  // fetched as a real "flat" print.
  const marketDetail = marketFlows.find(hasMarketStatusDetail) ?? marketFlows[0];

  return {
    market: marketFlows.length
      ? {
          date: marketDetail.date.toISOString().slice(0, 10),
          foreignNet: marketDetail.foreignNet,
          trustNet: marketDetail.trustNet,
          dealerNet: marketDetail.dealerNet,
          marginChange: marketDetail.marginChange,
          stale: marketDetail.date.getTime() !== marketFlows[0].date.getTime(),
          history: [...marketFlows].reverse().map((m) => ({
            date: m.date.toISOString().slice(0, 10),
            foreignNet: m.foreignNet,
            trustNet: m.trustNet,
            dealerNet: m.dealerNet,
          })),
        }
      : null,
    industries: industryFlows,
    rotationAlerts: alerts.map(toAlertRow),
  };
}

export async function getIndicatorOverview() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const indicators = await db.indicator.findMany({
    orderBy: [{ industry: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    include: {
      industry: {
        include: {
          // Indicator is 1:1 with Industry, so its industry's constituent
          // stocks ARE the real "which Taiwan names does this lead" answer —
          // no separate per-indicator mapping exists or needs inventing.
          stocks: { select: { ticker: true, name: true, nameZh: true }, orderBy: { ticker: "asc" } },
        },
      },
      values: { orderBy: { date: "desc" }, take: 16, include: { dataSource: true } },
    },
  });

  return indicators.map((ind) => {
    const newest = ind.values[0];
    const oldest = ind.values[ind.values.length - 1];
    const momentum = newest && oldest && oldest.value !== 0 ? ((newest.value - oldest.value) / oldest.value) * 100 : null;

    return {
      id: ind.id,
      key: ind.key,
      name: ind.name,
      unit: ind.unit,
      frequency: ind.frequency,
      higherIsBetter: ind.higherIsBetter,
      relatedStocks: ind.industry.stocks.map((s) => ({ ticker: s.ticker, name: s.nameZh ?? s.name })),
      description: ind.description,
      industryName: ind.industry.nameZh ?? ind.industry.name,
      industrySlug: ind.industry.slug,
      value: newest?.value ?? null,
      previousValue: newest?.previousValue ?? null,
      pctChange: newest?.pctChange ?? null,
      momentumPct: momentum !== null ? round2(momentum) : null,
      date: newest?.date.toISOString().slice(0, 10) ?? null,
      dataTimestamp: newest?.dataTimestamp.toISOString() ?? null,
      sourceName: newest?.dataSource?.name ?? null,
      sourceUrl: newest?.sourceUrl ?? null,
      isMock: newest?.isMock ?? true,
      history: [...ind.values].reverse().map((v) => ({ date: v.date.toISOString().slice(0, 10), value: v.value })),
    };
  });
}

export async function getAlerts(limit = 60) {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const alerts = await db.alert.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
    include: { industry: true, stocks: { include: { stock: true } } },
  });
  return alerts.map(toAlertRow);
}

export async function getLatestDailyBrief() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const brief = await db.dailyBrief.findFirst({ orderBy: { date: "desc" } });
  if (!brief) return null;

  const parse = (s: string): string[] => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };

  return {
    date: brief.date.toISOString().slice(0, 10),
    generatedBy: brief.generatedBy,
    createdAt: brief.createdAt.toISOString(),
    marketSummary: brief.marketSummary,
    sentimentSummary: brief.sentimentSummary,
    sentimentRising: parse(brief.sentimentRising),
    sentimentFalling: parse(brief.sentimentFalling),
    sentimentRankJumps: parse(brief.sentimentRankJumps),
    sentimentStrongClusters: parse(brief.sentimentStrongClusters),
    sentimentOverheated: parse(brief.sentimentOverheated),
    strongestIndustries: parse(brief.strongestIndustries),
    weakestIndustries: parse(brief.weakestIndustries),
    capitalRotation: brief.capitalRotation,
    leadingIndicatorChanges: parse(brief.leadingIndicatorChanges),
    institutionalActivity: brief.institutionalActivity,
    emergingThemes: parse(brief.emergingThemes),
    stocksToWatch: parse(brief.stocksToWatch),
    overheatedThemes: parse(brief.overheatedThemes),
    keyRisks: parse(brief.keyRisks),
    tomorrowWatchlist: parse(brief.tomorrowWatchlist),
    knownFacts: parse(brief.knownFacts),
    reasonableInference: parse(brief.reasonableInference),
    uncertainty: parse(brief.uncertainty),
  };
}

export interface WatchlistRow {
  id: string;
  itemType: "industry" | "stock" | "indicator";
  label: string;
  sublabel: string | null;
  href: string;
  note: string | null;
  /** Heat score for industries, price for stocks, latest value for indicators. */
  primaryValue: number;
  /** Score delta for industries, % change for stocks and indicators. */
  changeValue: number;
  changeIsPercent: boolean;
  status: string;
  rank: number | null;
  highlight: string | null;
  sparkline: number[];
  /** Industry rows only — drives the 資金流 word on the watchlist screen. */
  capitalFlowScore?: number;
  /** Stock rows only. */
  relativeStrength?: number;
  foreignNet?: number;
}

export async function getWatchlist(): Promise<WatchlistRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData, CACHE_TAGS.watchlist);
  const items = await db.watchlistItem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      industry: { include: { scores: { orderBy: { date: "desc" }, take: 30 } } },
      stock: {
        include: {
          industry: true,
          marketData: { orderBy: { date: "desc" }, take: 30 },
          flows: { where: { scope: "stock" }, orderBy: { date: "desc" }, take: 5 },
        },
      },
      indicator: {
        include: { industry: true, values: { orderBy: { date: "desc" }, take: 16 } },
      },
    },
  });

  const radar = await getIndustryRadar();
  const rankBySlug = new Map(
    [...radar].sort((a, b) => b.scoreToday - a.scoreToday).map((r, i) => [r.slug, i + 1]),
  );

  const rows: WatchlistRow[] = [];

  for (const item of items) {
    if (item.itemType === "industry" && item.industry) {
      const scores = item.industry.scores; // newest first
      const scoreToday = scores[0]?.totalScore ?? 0;
      const weekAgo = scores[Math.min(scores.length - 1, 7)]?.totalScore ?? scoreToday;
      const delta = round2(scoreToday - weekAgo);
      const rank = rankBySlug.get(item.industry.slug) ?? null;

      rows.push({
        id: item.id,
        itemType: "industry",
        label: item.industry.nameZh ?? item.industry.name,
        sublabel: item.industry.name,
        href: `/industries/${item.industry.slug}`,
        note: item.note,
        primaryValue: scoreToday,
        changeValue: delta,
        changeIsPercent: false,
        status: scores[0]?.status ?? "neutral",
        rank,
        highlight:
          rank !== null && rank <= 3
            ? `${item.industry.name} is in the Top 3 industry heat ranking (#${rank}).`
            : delta >= 5
              ? `${item.industry.name} heat score rose ${delta} points this week.`
              : null,
        sparkline: [...scores].reverse().map((s) => s.totalScore),
        capitalFlowScore: scores[0]?.capitalFlowScore ?? 0,
      });
      continue;
    }

    if (item.itemType === "stock" && item.stock) {
      const md = item.stock.marketData[0];
      const foreignStreak = countStreak(item.stock.flows, (f) => f.foreignNet > 0);

      rows.push({
        id: item.id,
        itemType: "stock",
        label: `${item.stock.nameZh ?? item.stock.name} ${item.stock.ticker}`,
        sublabel: item.stock.industry.name,
        href: `/industries/${item.stock.industry.slug}`,
        note: item.note,
        primaryValue: md?.close ?? 0,
        changeValue: md?.changePct ?? 0,
        changeIsPercent: true,
        status: item.stock.status,
        rank: null,
        relativeStrength: md?.relativeStrength ?? undefined,
        foreignNet: item.stock.flows[0]?.foreignNet ?? 0,
        highlight:
          foreignStreak >= 3
            ? `Foreign investors bought ${item.stock.ticker} ${item.stock.name} for ${foreignStreak} consecutive sessions.`
            : md?.technicalTrend === "breakout"
              ? `${item.stock.ticker} ${item.stock.name} broke above its consolidation range.`
              : null,
        sparkline: [...item.stock.marketData].reverse().map((m) => m.close),
      });
      continue;
    }

    if (item.itemType === "indicator" && item.indicator) {
      const vals = item.indicator.values; // newest first
      const newest = vals[0];
      const pctChange = newest?.pctChange ?? 0;
      // A rising inventory figure is bad news, so "improving" is direction-aware.
      const improving = item.indicator.higherIsBetter ? pctChange > 0 : pctChange < 0;

      rows.push({
        id: item.id,
        itemType: "indicator",
        label: item.indicator.name,
        sublabel: item.indicator.industry.name,
        href: `/industries/${item.indicator.industry.slug}`,
        note: item.note,
        primaryValue: newest?.value ?? 0,
        changeValue: pctChange,
        changeIsPercent: true,
        status: improving ? "improving" : "deteriorating",
        rank: null,
        highlight:
          Math.abs(pctChange) >= 5
            ? `${item.indicator.name} moved ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% in its latest reading — ${
                improving ? "a favourable" : "an unfavourable"
              } move for ${item.indicator.industry.name}.`
            : null,
        sparkline: [...vals].reverse().map((v) => v.value),
      });
      continue;
    }

    // The referenced row was deleted but the watchlist entry survived.
    rows.push({
      id: item.id,
      itemType: item.itemType as WatchlistRow["itemType"],
      label: "Unavailable item",
      sublabel: "The referenced record no longer exists",
      href: "/watchlist",
      note: item.note,
      primaryValue: 0,
      changeValue: 0,
      changeIsPercent: false,
      status: "neutral",
      rank: null,
      highlight: null,
      sparkline: [],
    });
  }

  return rows;
}

/** Lightweight id sets for star/toggle state — used across every screen that
 *  renders a ☆/★ next to an industry, stock, or indicator without needing
 *  the full derived WatchlistRow shape from getWatchlist(). */
export async function getWatchlistKeys(): Promise<{
  industryIds: Set<string>;
  stockIds: Set<string>;
  indicatorIds: Set<string>;
}> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.watchlist);
  const items = await db.watchlistItem.findMany({
    select: { itemType: true, industryId: true, stockId: true, indicatorId: true },
  });
  return {
    industryIds: new Set(items.filter((i) => i.itemType === "industry" && i.industryId).map((i) => i.industryId!)),
    stockIds: new Set(items.filter((i) => i.itemType === "stock" && i.stockId).map((i) => i.stockId!)),
    indicatorIds: new Set(items.filter((i) => i.itemType === "indicator" && i.indicatorId).map((i) => i.indicatorId!)),
  };
}

/** Options for the watchlist "add item" pickers. */
export async function getWatchlistOptions() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const [industries, stocks, indicators] = await Promise.all([
    db.industry.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.stock.findMany({
      orderBy: { ticker: "asc" },
      select: { id: true, ticker: true, name: true, industry: { select: { name: true } } },
    }),
    db.indicator.findMany({
      orderBy: [{ industry: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, industry: { select: { name: true } } },
    }),
  ]);

  return {
    industries: industries.map((i) => ({ id: i.id, label: i.name })),
    stocks: stocks.map((s) => ({ id: s.id, label: `${s.ticker} ${s.name} · ${s.industry.name}` })),
    indicators: indicators.map((i) => ({ id: i.id, label: `${i.name} · ${i.industry.name}` })),
  };
}

export async function getDataSources() {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  return db.dataSource.findMany({ orderBy: { category: "asc" } });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type StockWithRelations = {
  id: string;
  ticker: string;
  name: string;
  nameZh: string | null;
  status: string;
  mainCatalyst: string | null;
  mainRisk: string | null;
  marketData: Array<{
    close: number;
    changePct: number;
    volume: number;
    technicalTrend: string;
    relativeStrength: number | null;
    valuationPosition: string;
  }>;
  flows: Array<{ foreignNet: number; trustNet: number }>;
  fundamentals: Array<{ periodType: string; yoyChangePct: number | null; momChangePct: number | null; eps: number | null }>;
};

function toStockRow(s: StockWithRelations, industryName: string, industrySlug: string): StockRadarRow {
  const md = s.marketData[0];
  const revenue = s.fundamentals.find((f) => f.periodType === "monthly_revenue");
  const epsRow = s.fundamentals.find((f) => f.periodType === "ytd_eps");
  const buyStreak = countStreak(s.flows, (f) => f.foreignNet > 0);
  const sellStreak = countStreak(s.flows, (f) => f.foreignNet < 0);

  return {
    id: s.id,
    ticker: s.ticker,
    name: s.name,
    nameZh: s.nameZh,
    industryName,
    industrySlug,
    status: s.status as StockStatus,
    price: md?.close ?? 0,
    changePct: md?.changePct ?? 0,
    volume: md?.volume ?? 0,
    foreignNet: s.flows[0]?.foreignNet ?? 0,
    trustNet: s.flows[0]?.trustNet ?? 0,
    foreignStreak: (s.flows[0]?.foreignNet ?? 0) >= 0 ? buyStreak : -sellStreak,
    revenueYoy: revenue?.yoyChangePct ?? null,
    revenueMomChangePct: revenue?.momChangePct ?? null,
    eps: epsRow?.eps ?? null,
    technicalTrend: (md?.technicalTrend ?? "neutral") as TechnicalTrend,
    relativeStrength: md?.relativeStrength ?? null,
    valuationPosition: (md?.valuationPosition ?? "mid_range") as ValuationPosition,
    mainCatalyst: s.mainCatalyst,
    mainRisk: s.mainRisk,
    sparkline: [...s.marketData].reverse().map((m) => m.close),
  };
}

type AlertWithRelations = {
  id: string;
  timestamp: Date;
  ruleKey: string;
  title: string;
  description: string;
  importance: string;
  sourceIndicator: string | null;
  change: string | null;
  explanation: string;
  /** Absent when the alerts were already loaded nested under their industry. */
  industry?: { name: string; slug: string } | null;
  stocks: Array<{ stock: { ticker: string; name: string } }>;
};

function toAlertRow(a: AlertWithRelations) {
  return {
    id: a.id,
    timestamp: a.timestamp.toISOString(),
    ruleKey: a.ruleKey,
    title: a.title,
    description: a.description,
    importance: a.importance,
    sourceIndicator: a.sourceIndicator,
    change: a.change,
    explanation: a.explanation,
    industryName: a.industry?.name ?? null,
    industrySlug: a.industry?.slug ?? null,
    stocks: a.stocks.map((s) => ({ ticker: s.stock.ticker, name: s.stock.name })),
  };
}

export type AlertRow = ReturnType<typeof toAlertRow>;

function countStreak<T>(rows: T[], predicate: (row: T) => boolean): number {
  let n = 0;
  for (const r of rows) {
    if (predicate(r)) n++;
    else break;
  }
  return n;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/**
 * MarketStatus's breadth + institutional-flow bundle (breadthAdvancers,
 * breadthDecliners, foreignNet, trustNet, dealerNet, marginChange) is a
 * separate, rate-limited report from the session's index close, and all six
 * columns are NOT NULL @default(0) — there is no column that distinguishes
 * "not fetched" from "genuinely zero" (see the model in schema.prisma). But
 * on a real trading day these six are fetched together or not at all, and at
 * least one of them is essentially never exactly zero when they were, so a
 * row where all six are 0 is the insert-default sentinel, not a session
 * where nothing moved. Callers use this to skip such rows and fall back to
 * the last session that actually reported the bundle, rather than rendering
 * a defaulted 0 as a real "flat" reading.
 */
function hasMarketStatusDetail(row: {
  breadthAdvancers: number;
  breadthDecliners: number;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  marginChange: number;
}): boolean {
  return (
    row.breadthAdvancers !== 0 ||
    row.breadthDecliners !== 0 ||
    row.foreignNet !== 0 ||
    row.trustNet !== 0 ||
    row.dealerNet !== 0 ||
    row.marginChange !== 0
  );
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
