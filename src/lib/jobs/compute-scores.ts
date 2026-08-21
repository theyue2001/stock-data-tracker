import { db } from "@/lib/db";
import { getActiveScoreWeights } from "@/lib/score-weights";
import { classifyIndustryStatus, computeHeatScore } from "@/lib/scoring";
import { utcDay, utcDayOffset } from "@/lib/dates";
import type { ScoreComponents, ScoreWeights } from "@/lib/types";

/**
 * The single source of truth for how component scores are derived from raw
 * data. Both the historical backfill and the daily refresh call this, so a
 * score computed for last month and one computed today are directly
 * comparable — the week-over-week deltas the UI shows would otherwise be
 * measuring a change of formula rather than a change of market conditions.
 *
 * Everything is computed strictly "as of" the given date: no row dated after
 * `asOf` may influence the result, which is also what makes future
 * indicator-vs-subsequent-price backtesting possible.
 */

const CATALYST_WINDOW_DAYS = 21;
const TECHNICAL_LOOKBACK = 25;
const RS_LOOKBACK = 60;

/**
 * Maps an unbounded signal onto 0-100 centred on 50.
 *
 * A linear mapping (50 + x * k) pins to 0 or 100 as soon as the signal is
 * moderately strong, which collapses the whole scale to its extremes and makes
 * one industry indistinguishable from another. tanh compresses the tails while
 * staying near-linear in the middle, so ranking still works at both ends.
 *
 * `scale` is the signal value that should land at roughly 88 (tanh(1) ≈ 0.76).
 */
function squash(signal: number, scale: number): number {
  return 50 + 50 * Math.tanh(signal / scale);
}

interface IndustryScoreResult {
  industryId: string;
  components: ScoreComponents;
  totalScore: number;
  status: string;
}

export async function computeIndustryScoresForDate(
  asOfInput: Date,
  weightsOverride?: ScoreWeights,
): Promise<IndustryScoreResult[]> {
  const asOf = utcDay(asOfInput);
  const weights = weightsOverride ?? (await getActiveScoreWeights());

  const industries = await db.industry.findMany({
    include: {
      indicators: {
        include: { values: { where: { date: { lte: asOf } }, orderBy: { date: "desc" }, take: 8 } },
      },
      flows: {
        where: { scope: "industry", date: { lte: asOf } },
        orderBy: { date: "desc" },
        take: 5,
      },
      catalysts: { where: { date: { lte: asOf, gte: utcDayOffset(asOf, CATALYST_WINDOW_DAYS) } } },
      stocks: {
        include: {
          marketData: { where: { date: { lte: asOf } }, orderBy: { date: "desc" }, take: RS_LOOKBACK },
          fundamentals: { where: { periodType: "monthly_revenue" }, orderBy: { period: "desc" }, take: 6 },
        },
      },
    },
  });

  // Market return over the same window, so relative strength is measured
  // against the index rather than against zero.
  const marketRows = await db.marketStatus.findMany({
    where: { date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: RS_LOOKBACK,
  });
  const marketReturn =
    marketRows.length >= 2
      ? ((marketRows[0].close - marketRows[marketRows.length - 1].close) / marketRows[marketRows.length - 1].close) * 100
      : 0;

  // Capital flow is scored relative to the other industries on the same day,
  // so it needs a cross-industry pass before any single score is final.
  const flowTotals = industries.map((ind) => {
    const f = ind.flows[0];
    return f ? f.foreignNet + f.trustNet : 0;
  });
  const flowMax = Math.max(1, ...flowTotals.map(Math.abs));

  const asOfPeriod = periodKey(asOf);

  return industries.map((ind, i) => {
    // --- Fundamental: revenue YoY momentum across member stocks -----------
    // 25% average YoY revenue growth reads as a strong (~88) fundamental score.
    const yoys = ind.stocks
      .map((s) => s.fundamentals.find((f) => f.period <= asOfPeriod)?.yoyChangePct)
      .filter((v): v is number => v != null);
    const fundamentalScore = squash(avg(yoys), 25);

    // --- Leading indicators: sign-adjusted momentum -----------------------
    // Measured PER PERIOD, not cumulatively across the window: a cumulative
    // figure grows with however many readings happen to be stored, so the
    // score would drift purely from history length.
    const momenta = ind.indicators
      .map((indicator) => {
        const vals = indicator.values;
        if (vals.length < 2) return null;
        const oldest = vals[vals.length - 1];
        if (oldest.value === 0) return null;
        const pctMove = ((vals[0].value - oldest.value) / oldest.value) * 100;
        const perPeriod = pctMove / (vals.length - 1);
        // A rising inventory or capacity figure is bearish, so invert it.
        return indicator.higherIsBetter ? perPeriod : -perPeriod;
      })
      .filter((v): v is number => v !== null);
    const leadingIndicatorScore = squash(avg(momenta), 3);

    // --- Capital flow: normalized net institutional buying ----------------
    // Already bounded to -1..1 by the cross-industry normalization, so a
    // linear mapping is appropriate here.
    const capitalFlowScore = clamp(50 + (flowTotals[i] / flowMax) * 45, 0, 100);

    // --- Technical: trend participation + relative strength ---------------
    const perStock = ind.stocks.map((s) => classifyStockTechnicals(s.marketData, marketReturn));
    const withData = perStock.filter((p) => p !== null) as StockTechnicals[];
    const upShare = withData.length
      ? withData.filter((p) => p.trend === "uptrend" || p.trend === "breakout").length / withData.length
      : 0.5;
    const avgRS = withData.length ? avg(withData.map((p) => p.relativeStrength)) : 100;
    // Combines "how many names are participating" with "by how much the group
    // is beating the index"; both contribute, neither alone saturates it.
    const technicalScore = squash((upShare - 0.5) * 30 + (avgRS - 100), 18);

    // --- Catalyst: recency- and importance-weighted ------------------------
    const catalystPoints = ind.catalysts.reduce((sum, c) => {
      const ageDays = (asOf.getTime() - c.date.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / CATALYST_WINDOW_DAYS);
      const weight = c.importance === "high" ? 30 : c.importance === "medium" ? 18 : 9;
      return sum + weight * recency;
    }, 0);
    // No catalysts means "nothing notable", which is a neutral-to-low 30 —
    // not a zero, since absence of news is not bearish evidence.
    const catalystScore = catalystPoints === 0 ? 30 : squash(catalystPoints - 18, 22);

    const components: ScoreComponents = {
      fundamentalScore: round1(fundamentalScore),
      leadingIndicatorScore: round1(leadingIndicatorScore),
      capitalFlowScore: round1(capitalFlowScore),
      technicalScore: round1(technicalScore),
      catalystScore: round1(catalystScore),
    };

    return {
      industryId: ind.id,
      components,
      totalScore: computeHeatScore(components, weights),
      status: "neutral", // set by the caller, which knows the prior week's score
    };
  });
}

/** Computes and upserts scores for one date, resolving status against the
 *  score already stored for a week earlier. */
export async function persistIndustryScoresForDate(asOfInput: Date): Promise<number> {
  const asOf = utcDay(asOfInput);
  const weights = await getActiveScoreWeights();
  const results = await computeIndustryScoresForDate(asOf, weights);
  const weekAgo = utcDayOffset(asOf, 7);
  const snapshot = JSON.stringify(weights);

  for (const r of results) {
    const prior = await db.industryScore.findFirst({
      where: { industryId: r.industryId, date: { lte: weekAgo } },
      orderBy: { date: "desc" },
    });
    const status = classifyIndustryStatus(r.totalScore, prior?.totalScore ?? r.totalScore);

    await db.industryScore.upsert({
      where: { industryId_date: { industryId: r.industryId, date: asOf } },
      create: {
        industryId: r.industryId,
        date: asOf,
        ...r.components,
        totalScore: r.totalScore,
        weightsSnapshot: snapshot,
        status,
      },
      update: { ...r.components, totalScore: r.totalScore, weightsSnapshot: snapshot, status },
    });
  }

  return results.length;
}

/**
 * Backfills score history day by day, oldest first, so each day's status is
 * resolved against a week-earlier score that already exists.
 */
export async function backfillIndustryScores(days: number, referenceDate: Date = new Date()): Promise<number> {
  let written = 0;
  for (let i = days; i >= 0; i--) {
    written += await persistIndustryScoresForDate(utcDayOffset(referenceDate, i));
  }
  return written;
}

// ---------------------------------------------------------------------------

export interface StockTechnicals {
  trend: "uptrend" | "downtrend" | "neutral" | "breakout" | "breakdown";
  relativeStrength: number;
  valuationPosition: "low" | "mid_range" | "high" | "extended";
  /** Where the close sits in the 60-session range, 0..1. */
  rangePosition: number;
  /** Close vs. the 20-session mean, in percent. High values mean the move has
   *  run far ahead of its own trend line, which is what separates a parabolic
   *  advance from a healthy one — range position alone cannot, because any
   *  sustained uptrend sits near its highs by construction. */
  extensionPct: number;
}

/** Derives trend / relative strength / range position from a price series
 *  ordered newest-first. Exported so the stock radar shows the same numbers
 *  the scores were computed from. */
export function classifyStockTechnicals(
  seriesDesc: Array<{ close: number; high: number; low: number }>,
  marketReturnPct: number,
): StockTechnicals | null {
  if (seriesDesc.length < 8) return null;

  const latest = seriesDesc[0];
  const recent = seriesDesc.slice(0, 5);
  const prior = seriesDesc.slice(5, TECHNICAL_LOOKBACK);
  if (!prior.length) return null;

  const recentAvg = avg(recent.map((p) => p.close));
  const priorAvg = avg(prior.map((p) => p.close));
  const priorHigh = Math.max(...prior.map((p) => p.high));
  const priorLow = Math.min(...prior.map((p) => p.low));

  let trend: StockTechnicals["trend"] = "neutral";
  if (latest.close > priorHigh) trend = "breakout";
  else if (latest.close < priorLow) trend = "breakdown";
  else if (recentAvg > priorAvg * 1.02) trend = "uptrend";
  else if (recentAvg < priorAvg * 0.98) trend = "downtrend";

  const oldest = seriesDesc[seriesDesc.length - 1];
  const stockReturn = oldest.close !== 0 ? ((latest.close - oldest.close) / oldest.close) * 100 : 0;
  // Squashed rather than clamped: a hard clamp ties every strong name at the
  // ceiling, which destroys the ranking exactly where it matters most.
  const relativeStrength = 100 + 45 * Math.tanh((stockReturn - marketReturnPct) / 25);

  const rangeHigh = Math.max(...seriesDesc.map((p) => p.high));
  const rangeLow = Math.min(...seriesDesc.map((p) => p.low));
  const rangePosition = (latest.close - rangeLow) / Math.max(0.01, rangeHigh - rangeLow);
  const valuationPosition: StockTechnicals["valuationPosition"] =
    rangePosition > 0.92 ? "extended" : rangePosition > 0.7 ? "high" : rangePosition > 0.35 ? "mid_range" : "low";

  const ma20 = avg(seriesDesc.slice(0, 20).map((p) => p.close));
  const extensionPct = ma20 > 0 ? ((latest.close - ma20) / ma20) * 100 : 0;

  return {
    trend,
    relativeStrength: round1(relativeStrength),
    valuationPosition,
    rangePosition: Math.round(rangePosition * 1000) / 1000,
    extensionPct: round1(extensionPct),
  };
}

/**
 * Maps technicals plus fundamental momentum onto a cycle-position status.
 * Deliberately NOT a bullish/bearish score (spec §13): a strong business
 * already priced for perfection reads differently from a strong business the
 * market has not caught up to, and both differ from a weak one.
 *
 * Shared by the seeder and the refresh job so the stored label always matches
 * what the displayed numbers imply.
 */
export function deriveStockStatus(tech: StockTechnicals, revenueYoyPct: number | null): string {
  const { trend, relativeStrength: rs, valuationPosition, extensionPct } = tech;
  const growth = revenueYoyPct ?? 0;

  // Overheated needs the price stretched above its OWN trend, not merely near
  // the top of its range — an established uptrend is always near its highs.
  if (extensionPct >= 9 && rs >= 112 && valuationPosition === "extended") return "overheated";

  if (trend === "breakdown" || rs < 92) return "weakening";

  // Fundamentals improving while price has not yet followed the group.
  if (growth >= 8 && rs < 105 && trend !== "downtrend") return "potential_catch_up";

  if (trend === "breakout" && rs >= 106) return "trend_confirmed";
  if ((trend === "uptrend" || trend === "breakout") && rs >= 100) return "early_strengthening";
  if (trend === "downtrend") return "weakening";

  return "high_level_consolidation";
}

function periodKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
