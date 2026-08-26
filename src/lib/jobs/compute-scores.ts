import { db } from "@/lib/db";
import { getActiveScoreWeights } from "@/lib/score-weights";
import { classifyIndustryStatus, computeHeatScore } from "@/lib/scoring";
import { utcDateKey, utcDay, utcDayOffset } from "@/lib/dates";
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
 * Readings per year for each Indicator.frequency, used to annualize a
 * per-period move so series sampled at different rates can be averaged. Trading
 * days rather than calendar days for "daily", since these feeds only publish on
 * sessions.
 */
const PERIODS_PER_YEAR: Record<string, number> = { daily: 252, weekly: 52, monthly: 12, quarterly: 4 };

/**
 * Annualized percent move that should read as a strong (~88) leading-indicator
 * score. 60%/yr is deliberately high: these are demand and pricing proxies in
 * cyclical hardware supply chains, where a genuine upcycle moves freight rates
 * or memory contract prices by tens of percent a year, and a scale tight enough
 * to make a 10%/yr drift look decisive would put every series in an upcycle at
 * the ceiling together.
 */
const LEADING_INDICATOR_SCALE = 60;

/**
 * Where the catalyst curve is centred, in recency-weighted points per member
 * stock accumulated over the whole window. Derived from the real MOPS filing
 * volume, the only thing that can pin it down: on a sampled session the feed
 * carried filings for 10 of the 55 tracked stocks once same-day multi-document
 * filings are collapsed (~0.18 filers per name per session), and the 21-day
 * window holds ~15 sessions whose recency weights sum to ~7.7 — so a typical
 * name accrues ~1.4 recency-weighted filings.
 *
 * Those filings have to be priced at the weight the feed ACTUALLY delivers,
 * not at the "medium" weight. A sampled pull of the live 重大訊息 feed against
 * the tracked roster returns 0 high / 2 medium / 13 low, a mean weight of
 * (2*18 + 13*9) / 15 = 10.2 — so ~1.4 filings is ~14 points, not the ~25 that
 * pricing them all as medium implies. Centring on 25 does not merely shift the
 * curve: at 14 points of real signal it puts every industry at
 * squash(14 - 25, 30) = 33, under the 30 floor's shadow, which makes the
 * component a near-constant again — the same defect as before, mirrored to the
 * bottom of the range instead of the top.
 *
 * The reference weight therefore tracks the importance mapping in
 * src/lib/providers/live/catalyst-provider.ts, and retuning that mapping means
 * re-sampling the mix and revisiting this number. That coupling is real and
 * cannot be designed away by choosing a fixed reference weight.
 *
 * The scale keeps the ~1.2x scale-to-midpoint ratio of the first calibration,
 * which leaves a normal month of filings reading in the fifties and needs
 * roughly triple-normal intensity to reach the high nineties. The original
 * numbers (midpoint 18 on the un-normalized industry total) were fitted to the
 * seeded sample of 1-2 catalysts per industry per window; the live feed
 * delivers that much in a single session, which pinned every industry with any
 * filing at all to ~100.
 */
const CATALYST_MIDPOINT_POINTS = 14;
const CATALYST_POINTS_SCALE = 17;

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
  /**
   * The weighting `totalScore` was ACTUALLY computed with, which is not always
   * the configured one: a component with no input data is dropped by zeroing
   * its weight (see the leading-indicator block below). This is what gets
   * snapshotted onto the row, so `weightsSnapshot` doubles as the record of
   * which components took part — see `componentParticipated` in scoring.ts.
   */
  weights: ScoreWeights;
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
        take: 1,
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
    // Only a row actually dated to the session being scored counts, which is
    // the same check compute-sentiment's flowIsCurrent makes before it reports
    // a flow figure. The T86 report can be missing or dated a session behind
    // the price snapshot it is aggregated against, and without this the newest
    // stored row — yesterday's — would be scored as today's net buying, while
    // the sentiment snapshot for the same date correctly says there is none.
    if (!f || utcDateKey(f.date) !== utcDateKey(asOf)) return 0;
    return f.foreignNet + f.trustNet;
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
    //
    // Then ANNUALIZED before scoring, because a per-period move is not
    // comparable across the frequencies this taxonomy mixes: 2% a week and 2%
    // a quarter are the same number and eight times apart in meaning. Averaging
    // them raw let the fastest-sampled series dominate an industry's reading,
    // and pinned any quarterly series with real growth to the ceiling — the
    // hyperscaler capex series compounds ~26% a quarter, which the old
    // per-period scale of 3 mapped to exactly 100.0 every session, making the
    // component a constant for that industry.
    const momenta = ind.indicators
      .map((indicator) => {
        const vals = indicator.values;
        if (vals.length < 2) return null;
        const oldest = vals[vals.length - 1];
        if (oldest.value === 0) return null;
        const pctMove = ((vals[0].value - oldest.value) / oldest.value) * 100;
        const perPeriod = pctMove / (vals.length - 1);
        const annualized = perPeriod * (PERIODS_PER_YEAR[indicator.frequency] ?? PERIODS_PER_YEAR.weekly);
        // A rising inventory or capacity figure is bearish, so invert it.
        return indicator.higherIsBetter ? annualized : -annualized;
      })
      .filter((v): v is number => v !== null);

    // An industry with no usable series must be EXCLUDED from the weighting,
    // not scored as neutral. `avg([])` is 0 and squash(0) is exactly 50, so
    // until licensed indicator data is imported almost every industry scored a
    // flat 50 here — 25% of the weight spent on a constant. That does not just
    // add noise: it pulls every total toward the middle by a quarter of its
    // range, compressing the spread the ranking is supposed to expose, and the
    // UI presented the 50 as a genuine "持平" reading of real indicators.
    //
    // computeHeatScore divides by the weight sum, so zeroing this weight
    // renormalizes the others automatically and the total becomes the honest
    // weighted average of the components that do have data. The stored
    // component stays 50 (the column is NOT NULL and a 0 would read as
    // bearish); the zeroed weight in weightsSnapshot is the record that it did
    // not participate, and what the UI reads to show 無資料 instead of a number.
    const hasLeadingIndicators = momenta.length > 0;
    const leadingIndicatorScore = hasLeadingIndicators ? squash(avg(momenta), LEADING_INDICATOR_SCALE) : 50;
    const effectiveWeights: ScoreWeights = hasLeadingIndicators
      ? weights
      : { ...weights, leadingIndicatorWeight: 0 };

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

    // --- Catalyst: recency- and importance-weighted news intensity ---------
    // Only the heaviest filing a company made on a session counts. MOPS
    // routinely splits one event across several documents — a parent filing
    // separately on behalf of two subsidiaries, a 補充公告 amending an earlier
    // notice — and adding those up reads a single event as a news cluster.
    const heaviestPerFilerDay = new Map<string, number>();
    // A catalyst attached to the industry rather than to a member company is
    // already a statement about the whole group, so it is accumulated raw
    // instead of being divided down per name below.
    let groupPoints = 0;
    for (const c of ind.catalysts) {
      const ageDays = (asOf.getTime() - c.date.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / CATALYST_WINDOW_DAYS);
      const weight = c.importance === "high" ? 30 : c.importance === "medium" ? 18 : 9;
      if (!c.stockId) {
        groupPoints += weight * recency;
        continue;
      }
      const filerDay = `${c.stockId}|${utcDateKey(c.date)}`;
      heaviestPerFilerDay.set(filerDay, Math.max(heaviestPerFilerDay.get(filerDay) ?? 0, weight * recency));
    }
    // Company filings are scored PER MEMBER NAME. A raw window total grows with
    // how many tickers the industry happens to have on the tracked list and
    // with how many sessions the calendar window happens to contain, so the
    // ranking such a total produces is mostly roster size and holiday
    // placement rather than news.
    const filingPoints =
      [...heaviestPerFilerDay.values()].reduce((sum, p) => sum + p, 0) / Math.max(1, ind.stocks.length);
    // No catalysts means "nothing notable", which is a neutral-to-low 30 —
    // not a zero, since absence of news is not bearish evidence. A floor
    // rather than a special case for exactly zero, because a thin month of
    // filings is not bearish evidence either: a discontinuity there would rank
    // a silent industry above one that managed a single minor filing.
    const catalystScore = Math.max(
      30,
      squash(filingPoints + groupPoints - CATALYST_MIDPOINT_POINTS, CATALYST_POINTS_SCALE),
    );

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
      weights: effectiveWeights,
      totalScore: computeHeatScore(components, effectiveWeights),
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

  for (const r of results) {
    // Per row, not one snapshot for the batch: an industry whose components
    // could not all be computed was scored on a reduced weighting, and storing
    // the configured weighting instead would claim a total that this row's own
    // numbers cannot reproduce.
    const snapshot = JSON.stringify(r.weights);
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
