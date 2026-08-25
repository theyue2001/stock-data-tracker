import { db } from "@/lib/db";
import { utcDay, utcDateKey } from "@/lib/dates";
import { detectBreakout, type PriceBar } from "@/lib/breakout";
import { getActiveSentimentWeights } from "@/lib/sentiment-weights";
import {
  advancingRatioScore,
  averageReturnScore,
  breakoutRatioScore,
  classifySentimentStatus,
  computeSentimentScore,
  institutionalFlowScore,
  relativeStrengthScore,
  volumeExpansionScore,
} from "@/lib/sentiment";
import type { SentimentComponents, SentimentStatus, SentimentWeights } from "@/lib/types";

/**
 * The single source of truth for deriving Industry Sentiment from raw market
 * data. The daily refresh, the seed backfill, the sub-industry tab, and the
 * API all call in here, so a score computed for last week and one computed
 * today are directly comparable — the day-over-day deltas the module is built
 * around would otherwise be measuring a change of formula.
 *
 * Everything is computed strictly "as of" the given date: no row dated after
 * `asOf` may influence the result.
 */

/** Sessions of price history loaded per stock. 21 is the minimum the
 *  20-session volume average and the 20-day-high breakout rule both need. */
const SERIES_LOOKBACK = 26;
const VOLUME_AVG_SESSIONS = 20;
const ROLLING_RS_SESSIONS = 5;

// ---------------------------------------------------------------------------
// Shared group computation
// ---------------------------------------------------------------------------

interface SeriesBar extends PriceBar {
  date: Date;
  changePct: number;
}

interface GroupMember {
  id: string;
  ticker: string;
  name: string;
  nameZh: string | null;
  /** Newest-first, already filtered to `date <= asOf`. */
  series: SeriesBar[];
}

/** Where the group's institutional figures came from. Surfaced so the UI can
 *  distinguish a measured industry-level print from a pro-rated estimate
 *  (spec §11: isolate and label fallback values rather than silently
 *  presenting them as real). */
export type FlowSource = "industry" | "stock" | "prorated" | "none";

interface GroupInput {
  key: string;
  members: GroupMember[];
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  flowSource: FlowSource;
}

interface MarketReturns {
  dailyPct: number;
  fiveDayPct: number;
}

export interface GroupSentiment {
  key: string;
  components: SentimentComponents;
  sentimentScore: number;
  // raw measures
  advancingCount: number;
  flatCount: number;
  decliningCount: number;
  stockCount: number;
  advancingSharePct: number;
  averageReturnPct: number;
  volumeRatio: number;
  turnover: number;
  breakoutCount: number;
  /** Members whose breakout was also confirmed by volume expansion. */
  breakoutVolumeConfirmedCount: number;
  breakoutTickers: string[];
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  flowSource: FlowSource;
  relativeStrengthPct: number;
  rollingRelativeStrengthPct: number;
  /** The session the figures describe — the latest at or before `asOf`. */
  sessionDate: Date | null;
  /** Largest single-member contribution to the group return, in points. Lets
   *  the UI answer "is this one limit-up or the whole group?" without
   *  recomputing anything. */
  topContributorTicker: string | null;
  topContributorSharePct: number;
}

function computeGroupSentiment(group: GroupInput, market: MarketReturns, weights: SentimentWeights): GroupSentiment {
  const members = group.members.filter((m) => m.series.length > 0);

  // Session grid: the union of dates across members, newest first. Built from
  // dates rather than array positions so a member with a shorter history
  // cannot silently shift the whole group's volume baseline.
  const turnoverByDate = new Map<string, number>();
  for (const m of members) {
    for (const bar of m.series) {
      const key = utcDateKey(bar.date);
      turnoverByDate.set(key, (turnoverByDate.get(key) ?? 0) + (bar.close * bar.volume) / 1000);
    }
  }
  const sessionKeys = [...turnoverByDate.keys()].sort().reverse();
  const todayKey = sessionKeys[0] ?? null;

  const todayTurnover = todayKey ? (turnoverByDate.get(todayKey) ?? 0) : 0;
  const priorKeys = sessionKeys.slice(1, VOLUME_AVG_SESSIONS + 1);
  const avgTurnover = priorKeys.length
    ? priorKeys.reduce((sum, k) => sum + (turnoverByDate.get(k) ?? 0), 0) / priorKeys.length
    : 0;
  // No trailing history yet means "we cannot tell", which is 1.0x (neutral),
  // not 0 — a zero would read as "nobody traded this group".
  const volumeRatio = avgTurnover > 0 ? todayTurnover / avgTurnover : 1;

  // --- Breadth ------------------------------------------------------------
  let advancingCount = 0;
  let flatCount = 0;
  let decliningCount = 0;
  const returns: Array<{ ticker: string; changePct: number }> = [];

  for (const m of members) {
    const bar = todayKey ? m.series.find((b) => utcDateKey(b.date) === todayKey) : undefined;
    if (!bar) continue;
    if (bar.changePct > 0) advancingCount++;
    else if (bar.changePct < 0) decliningCount++;
    else flatCount++;
    returns.push({ ticker: m.ticker, changePct: bar.changePct });
  }

  const stockCount = returns.length;
  const averageReturnPct = stockCount ? returns.reduce((s, r) => s + r.changePct, 0) / stockCount : 0;
  const advancingSharePct = stockCount ? advancingCount / stockCount : 0;

  // Concentration: how much of the group's average return one name accounts
  // for. `Industry +5% because ten names rose` and `Industry +5% because one
  // limit-up dragged the average` are different facts (spec §7).
  let topContributorTicker: string | null = null;
  let topContributorSharePct = 0;
  if (stockCount > 0 && Math.abs(averageReturnPct) > 0.001) {
    const top = [...returns].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
    topContributorTicker = top.ticker;
    topContributorSharePct = Math.abs(top.changePct / stockCount / averageReturnPct) * 100;
  }

  // --- Breakouts ----------------------------------------------------------
  let breakoutCount = 0;
  let breakoutVolumeConfirmedCount = 0;
  const breakoutTickers: string[] = [];
  for (const m of members) {
    const result = detectBreakout(m.series);
    if (!result.isBreakout) continue;
    breakoutCount++;
    breakoutTickers.push(m.ticker);
    if (result.volumeConfirmed) breakoutVolumeConfirmedCount++;
  }

  // --- Relative strength --------------------------------------------------
  const fiveDayReturns = members
    .map((m) => {
      if (m.series.length <= ROLLING_RS_SESSIONS) return null;
      const then = m.series[ROLLING_RS_SESSIONS].close;
      if (then <= 0) return null;
      return ((m.series[0].close - then) / then) * 100;
    })
    .filter((v): v is number => v !== null);
  const groupFiveDayPct = fiveDayReturns.length ? fiveDayReturns.reduce((a, b) => a + b, 0) / fiveDayReturns.length : 0;

  const relativeStrengthPct = averageReturnPct - market.dailyPct;
  const rollingRelativeStrengthPct = groupFiveDayPct - market.fiveDayPct;

  // --- Components ---------------------------------------------------------
  const components: SentimentComponents = {
    advancingRatio: round1(advancingRatioScore(advancingCount, stockCount)),
    averageReturn: round1(averageReturnScore(averageReturnPct)),
    volumeExpansion: round1(volumeExpansionScore(volumeRatio)),
    breakoutRatio: round1(breakoutRatioScore(breakoutCount, stockCount)),
    // With no flow figure at all the component is a neutral 50 rather than 0:
    // missing data is not evidence of selling.
    institutionalFlowScore:
      group.flowSource === "none"
        ? 50
        : round1(institutionalFlowScore(group.foreignNet, group.trustNet, group.dealerNet, todayTurnover)),
    relativeStrengthScore: round1(relativeStrengthScore(relativeStrengthPct, rollingRelativeStrengthPct)),
  };

  return {
    key: group.key,
    components,
    sentimentScore: computeSentimentScore(components, weights),
    advancingCount,
    flatCount,
    decliningCount,
    stockCount,
    advancingSharePct: round3(advancingSharePct),
    averageReturnPct: round2(averageReturnPct),
    volumeRatio: round2(volumeRatio),
    turnover: Math.round(todayTurnover),
    breakoutCount,
    breakoutVolumeConfirmedCount,
    breakoutTickers,
    foreignNet: group.foreignNet,
    trustNet: group.trustNet,
    dealerNet: group.dealerNet,
    flowSource: group.flowSource,
    relativeStrengthPct: round2(relativeStrengthPct),
    rollingRelativeStrengthPct: round2(rollingRelativeStrengthPct),
    sessionDate: members[0]?.series[0]?.date ?? null,
    topContributorTicker,
    topContributorSharePct: round1(topContributorSharePct),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadMarketReturns(asOf: Date): Promise<MarketReturns> {
  const rows = await db.marketStatus.findMany({
    where: { date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: ROLLING_RS_SESSIONS + 1,
  });
  if (!rows.length) return { dailyPct: 0, fiveDayPct: 0 };
  const dailyPct = rows[0].changePct;
  const then = rows[Math.min(ROLLING_RS_SESSIONS, rows.length - 1)]?.close;
  const fiveDayPct = then && then > 0 ? ((rows[0].close - then) / then) * 100 : 0;
  return { dailyPct, fiveDayPct };
}

type LoadedIndustry = Awaited<ReturnType<typeof loadIndustries>>[number];

async function loadIndustries(asOf: Date) {
  return db.industry.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      flows: { where: { scope: "industry", date: { lte: asOf } }, orderBy: { date: "desc" }, take: 1 },
      stocks: {
        include: {
          marketData: { where: { date: { lte: asOf } }, orderBy: { date: "desc" }, take: SERIES_LOOKBACK },
          flows: { where: { scope: "stock", date: { lte: asOf } }, orderBy: { date: "desc" }, take: 1 },
        },
      },
    },
  });
}

function toMembers(stocks: LoadedIndustry["stocks"]): GroupMember[] {
  return stocks.map((s) => ({
    id: s.id,
    ticker: s.ticker,
    name: s.name,
    nameZh: s.nameZh,
    series: s.marketData.map((m) => ({
      date: m.date,
      close: m.close,
      high: m.high,
      low: m.low,
      volume: m.volume,
      changePct: m.changePct,
    })),
  }));
}

/** True only when the flow row actually describes the session being scored —
 *  a stale row from an earlier date must not be presented as today's flow. */
function flowIsCurrent(flowDate: Date | undefined, sessionDate: Date | null): boolean {
  if (!flowDate || !sessionDate) return false;
  return utcDateKey(flowDate) === utcDateKey(sessionDate);
}

// ---------------------------------------------------------------------------
// Industry-level
// ---------------------------------------------------------------------------

export interface IndustrySentimentResult extends GroupSentiment {
  industryId: string;
  slug: string;
  name: string;
  nameZh: string | null;
}

export async function computeIndustrySentimentForDate(
  asOfInput: Date,
  weightsOverride?: SentimentWeights,
): Promise<IndustrySentimentResult[]> {
  const asOf = utcDay(asOfInput);
  const weights = weightsOverride ?? (await getActiveSentimentWeights());
  const [industries, market] = await Promise.all([loadIndustries(asOf), loadMarketReturns(asOf)]);

  return industries.map((ind) => {
    const members = toMembers(ind.stocks);
    const sessionDate = members.map((m) => m.series[0]?.date).find(Boolean) ?? null;
    const flow = ind.flows[0];
    const hasFlow = flowIsCurrent(flow?.date, sessionDate);

    const group = computeGroupSentiment(
      {
        key: ind.slug,
        members,
        foreignNet: hasFlow ? flow.foreignNet : 0,
        trustNet: hasFlow ? flow.trustNet : 0,
        dealerNet: hasFlow ? flow.dealerNet : 0,
        flowSource: hasFlow ? "industry" : "none",
      },
      market,
      weights,
    );

    return { ...group, industryId: ind.id, slug: ind.slug, name: ind.name, nameZh: ind.nameZh };
  });
}

/** Sorts by score and assigns 1-based ranks. Ties break on breadth, then on
 *  key, so a rank is stable across runs rather than depending on row order. */
function assignRanks<T extends { sentimentScore: number; advancingSharePct: number; key: string }>(rows: T[]): Array<T & { rank: number }> {
  return [...rows]
    .sort((a, b) => b.sentimentScore - a.sentimentScore || b.advancingSharePct - a.advancingSharePct || a.key.localeCompare(b.key))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Computes and upserts one session's sentiment snapshots, resolving each
 * industry's rank change and status against the snapshots already stored for
 * previous sessions.
 */
export async function persistIndustrySentimentForDate(asOfInput: Date): Promise<number> {
  const asOf = utcDay(asOfInput);
  const weights = await getActiveSentimentWeights();
  const results = await computeIndustrySentimentForDate(asOf, weights);
  const ranked = assignRanks(results);
  const snapshot = JSON.stringify(weights);

  for (const r of ranked) {
    // Previous SESSIONS, by row, rather than by calendar offset: the ranking
    // trend the UI draws is "the last five readings", and counting days would
    // silently skip weekends and holidays.
    const history = await db.industrySentimentSnapshot.findMany({
      where: { industryId: r.industryId, date: { lt: asOf } },
      orderBy: { date: "desc" },
      take: ROLLING_RS_SESSIONS,
    });

    const previous = history[0] ?? null;
    const previousRank = previous?.rank ?? null;
    const rank5dAgo = history.length ? (history[ROLLING_RS_SESSIONS - 1] ?? history[history.length - 1]).rank : null;
    const scoreDelta = previous ? r.sentimentScore - previous.sentimentScore : 0;
    const rankDelta = previousRank !== null ? previousRank - r.rank : 0;

    const status: SentimentStatus = classifySentimentStatus({
      score: r.sentimentScore,
      scoreDelta,
      rankDelta,
      advancingShare: r.advancingSharePct,
      averageReturnPct: r.averageReturnPct,
      volumeRatio: r.volumeRatio,
      relativeStrengthPct: r.relativeStrengthPct,
    });

    const data = {
      sentimentScore: r.sentimentScore,
      advancingRatio: r.components.advancingRatio,
      averageReturn: r.components.averageReturn,
      volumeExpansion: r.components.volumeExpansion,
      breakoutRatio: r.components.breakoutRatio,
      institutionalFlowScore: r.components.institutionalFlowScore,
      relativeStrengthScore: r.components.relativeStrengthScore,
      advancingSharePct: r.advancingSharePct,
      advancingCount: r.advancingCount,
      flatCount: r.flatCount,
      decliningCount: r.decliningCount,
      stockCount: r.stockCount,
      averageReturnPct: r.averageReturnPct,
      volumeRatio: r.volumeRatio,
      breakoutCount: r.breakoutCount,
      foreignNet: r.foreignNet,
      trustNet: r.trustNet,
      dealerNet: r.dealerNet,
      relativeStrengthPct: r.relativeStrengthPct,
      rank: r.rank,
      previousRank,
      rank5dAgo,
      rankDelta,
      status,
      weightsSnapshot: snapshot,
    };

    await db.industrySentimentSnapshot.upsert({
      where: { industryId_date: { industryId: r.industryId, date: asOf } },
      create: { industryId: r.industryId, date: asOf, ...data },
      update: data,
    });
  }

  return ranked.length;
}

/** Backfills sentiment history oldest-first so each session's rank delta and
 *  status resolve against a previous session that already exists. */
export async function backfillIndustrySentiment(days: number, referenceDate: Date = new Date()): Promise<number> {
  let written = 0;
  const base = utcDay(referenceDate);
  for (let i = days; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    written += await persistIndustrySentimentForDate(d);
  }
  return written;
}

// ---------------------------------------------------------------------------
// Sub-industry level (細產業)
// ---------------------------------------------------------------------------

export interface SubIndustrySentimentResult extends GroupSentiment {
  /** `${industrySlug}::${subIndustry}` — stable identity for the row. */
  key: string;
  industryId: string;
  industrySlug: string;
  industryName: string;
  industryNameZh: string | null;
  subIndustry: string;
  subIndustryZh: string;
  tickers: string[];
}

/**
 * Scores the finer sub-groups inside each industry with the SAME formula the
 * parent industries use, so a sub-industry's 氣氛值 is directly comparable
 * with an industry's.
 *
 * Not persisted (unlike industry snapshots): spec §9 defines history at
 * industry level, and sub-groups are cheap to recompute from the same price
 * series already loaded. Day-over-day rank change is therefore derived by
 * running the same computation for the previous session rather than read from
 * a table.
 *
 * Institutional flow is the one figure that genuinely does not exist at this
 * granularity. Where per-stock flow rows are available they are summed
 * (measured, `flowSource: "stock"`); otherwise the parent industry's flow is
 * apportioned by the sub-group's share of industry turnover and flagged
 * `"prorated"` so the UI can mark it as an estimate rather than a print.
 */
export async function computeSubIndustrySentimentForDate(
  asOfInput: Date,
  weightsOverride?: SentimentWeights,
): Promise<SubIndustrySentimentResult[]> {
  const asOf = utcDay(asOfInput);
  const weights = weightsOverride ?? (await getActiveSentimentWeights());
  const [industries, market] = await Promise.all([loadIndustries(asOf), loadMarketReturns(asOf)]);

  const out: SubIndustrySentimentResult[] = [];

  for (const ind of industries) {
    const industryFlow = ind.flows[0];
    const industryTurnover = ind.stocks.reduce((sum, s) => {
      const bar = s.marketData[0];
      return sum + (bar ? (bar.close * bar.volume) / 1000 : 0);
    }, 0);

    // Stocks with no sub-classification fall back to the industry itself, so
    // a partially-classified industry still contributes every member.
    const groups = new Map<string, { zh: string; stocks: LoadedIndustry["stocks"] }>();
    for (const s of ind.stocks) {
      const label = s.subIndustry ?? ind.name;
      const zh = s.subIndustryZh ?? ind.nameZh ?? ind.name;
      const bucket = groups.get(label);
      if (bucket) bucket.stocks.push(s);
      else groups.set(label, { zh, stocks: [s] });
    }

    for (const [subIndustry, bucket] of groups) {
      const members = toMembers(bucket.stocks);
      const sessionDate = members.map((m) => m.series[0]?.date).find(Boolean) ?? null;

      const stockFlows = bucket.stocks
        .map((s) => s.flows[0])
        .filter((f) => flowIsCurrent(f?.date, sessionDate));

      let foreignNet = 0;
      let trustNet = 0;
      let dealerNet = 0;
      let flowSource: FlowSource = "none";

      if (stockFlows.length) {
        flowSource = "stock";
        for (const f of stockFlows) {
          foreignNet += f.foreignNet;
          trustNet += f.trustNet;
          dealerNet += f.dealerNet;
        }
      } else if (flowIsCurrent(industryFlow?.date, sessionDate) && industryTurnover > 0) {
        const subTurnover = bucket.stocks.reduce((sum, s) => {
          const bar = s.marketData[0];
          return sum + (bar ? (bar.close * bar.volume) / 1000 : 0);
        }, 0);
        const share = subTurnover / industryTurnover;
        flowSource = "prorated";
        foreignNet = Math.round(industryFlow.foreignNet * share);
        trustNet = Math.round(industryFlow.trustNet * share);
        dealerNet = Math.round(industryFlow.dealerNet * share);
      }

      const key = `${ind.slug}::${subIndustry}`;
      const group = computeGroupSentiment(
        { key, members, foreignNet, trustNet, dealerNet, flowSource },
        market,
        weights,
      );

      out.push({
        ...group,
        key,
        industryId: ind.id,
        industrySlug: ind.slug,
        industryName: ind.name,
        industryNameZh: ind.nameZh,
        subIndustry,
        subIndustryZh: bucket.zh,
        tickers: bucket.stocks.map((s) => s.ticker),
      });
    }
  }

  return out;
}

export interface RankedSubIndustry extends SubIndustrySentimentResult {
  rank: number;
  previousRank: number | null;
  rankDelta: number;
  scoreDelta: number;
  status: SentimentStatus;
}

/**
 * Sub-industry rows with today's rank and the day-over-day change, derived by
 * running the same computation against the previous session. `previousDate`
 * is resolved from MarketStatus so it tracks real sessions rather than
 * calendar days.
 */
export async function getRankedSubIndustrySentiment(asOfInput: Date = new Date()): Promise<RankedSubIndustry[]> {
  const asOf = utcDay(asOfInput);
  const weights = await getActiveSentimentWeights();

  const sessions = await db.marketStatus.findMany({
    where: { date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: 2,
    select: { date: true },
  });
  const previousDate = sessions[1]?.date ?? null;

  const [today, previous] = await Promise.all([
    computeSubIndustrySentimentForDate(asOf, weights),
    previousDate ? computeSubIndustrySentimentForDate(previousDate, weights) : Promise.resolve([]),
  ]);

  const rankedToday = assignRanks(today);
  const previousRankByKey = new Map(assignRanks(previous).map((r) => [r.key, r.rank]));
  const previousScoreByKey = new Map(previous.map((r) => [r.key, r.sentimentScore]));

  return rankedToday.map((r) => {
    const previousRank = previousRankByKey.get(r.key) ?? null;
    const rankDelta = previousRank !== null ? previousRank - r.rank : 0;
    const priorScore = previousScoreByKey.get(r.key);
    const scoreDelta = priorScore != null ? round1(r.sentimentScore - priorScore) : 0;

    return {
      ...r,
      previousRank,
      rankDelta,
      scoreDelta,
      status: classifySentimentStatus({
        score: r.sentimentScore,
        scoreDelta,
        rankDelta,
        advancingShare: r.advancingSharePct,
        averageReturnPct: r.averageReturnPct,
        volumeRatio: r.volumeRatio,
        relativeStrengthPct: r.relativeStrengthPct,
      }),
    };
  });
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
