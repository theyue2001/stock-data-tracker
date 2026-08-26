import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { getRankedSubIndustrySentiment, type FlowSource } from "@/lib/jobs/compute-sentiment";
import {
  classifyQuadrant,
  sentimentComponentParticipated,
  type SentimentHeatQuadrant,
} from "@/lib/sentiment";
import type { SentimentComponents, SentimentStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Read models for the 產業氣氛 / Industry Momentum module.
//
// Kept in their own module rather than bolted onto src/lib/queries.ts so the
// short-term sentiment layer stays visibly separate from the medium-term heat
// layer at every level of the stack — schema, service, query, and UI.
// ---------------------------------------------------------------------------

/**
 * Snapshots the trend sparkline and rank path render.
 *
 * Six, not five: a "5-day trend" is five day-over-day CHANGES, which needs
 * six observations. Six also makes the path start exactly at the stored
 * `rank5dAgo` (five sessions before today), so the sparkline, the
 * "#11 → #8 → #6 → #3 → #1" path and the stored 5-day rank all describe the
 * same window instead of three subtly different ones.
 */
const TREND_SESSIONS = 6;

export interface IndustrySentimentRow {
  id: string;
  slug: string;
  name: string;
  nameZh: string | null;
  date: string;

  sentimentScore: number;
  /** Change vs. the previous session. The module's headline signal (spec §13). */
  scoreDelta: number;
  components: SentimentComponents;

  rank: number;
  previousRank: number | null;
  rank5dAgo: number | null;
  rankDelta: number;
  status: SentimentStatus;

  advancingCount: number;
  flatCount: number;
  decliningCount: number;
  stockCount: number;
  advancingSharePct: number;
  averageReturnPct: number;
  volumeRatio: number;
  breakoutCount: number;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  relativeStrengthPct: number;

  /** Oldest-first, up to 6 sessions (= 5 day-over-day changes). The first
   *  element corresponds to `rank5dAgo`. */
  sentimentTrend: number[];
  rankTrend: number[];

  /**
   * Where the group's institutional figures came from, recovered from the
   * stored `weightsSnapshot` rather than a column of its own.
   *
   * This used to be hard-coded to "industry" on every row, so an industry whose
   * session had no T86 print showed its inert filler 50 as a real 中性 reading —
   * the sub-industry rows carried a true flowSource and the industry rows never
   * could. A zeroed `institutionalFlowWeight` is the scoring pass's record that
   * the component did not take part, which is exactly the "none" case.
   */
  flowSource: FlowSource;

  /** The medium-term Industry Heat Score, carried alongside for the spec §10
   *  Case A-D comparison. Never blended into the sentiment score. */
  heatScore: number;
  quadrant: SentimentHeatQuadrant;
}

export interface SubIndustrySentimentRow {
  key: string;
  industrySlug: string;
  industryName: string;
  industryNameZh: string | null;
  subIndustry: string;
  subIndustryZh: string;
  tickers: string[];

  sentimentScore: number;
  scoreDelta: number;
  rank: number;
  previousRank: number | null;
  rankDelta: number;
  status: SentimentStatus;

  advancingCount: number;
  flatCount: number;
  decliningCount: number;
  stockCount: number;
  advancingSharePct: number;
  averageReturnPct: number;
  volumeRatio: number;
  breakoutCount: number;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  relativeStrengthPct: number;
  /** "stock" = summed real per-stock prints, "prorated" = apportioned from
   *  the parent industry (an estimate), "none" = no flow data for the group. */
  flowSource: string;
}

export interface IndustryMomentum {
  /** Session the readings describe, or null when nothing has been computed. */
  date: string | null;
  industries: IndustrySentimentRow[];
  subIndustries: SubIndustrySentimentRow[];
}

/**
 * Everything the Overview module's three tabs need. Industry rows come from
 * the stored snapshots (spec §9); sub-industry rows are computed on demand
 * from the same price series (see compute-sentiment.ts for why).
 */
export async function getIndustryMomentum(): Promise<IndustryMomentum> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  return loadIndustryMomentum();
}

/**
 * The same read, uncached.
 *
 * `"use cache"` and `cacheLife()` only work inside the Next.js server runtime,
 * so a cached function throws when called from a plain `tsx` job script — which
 * is exactly what the daily brief job is. Pages call the cached wrapper above;
 * jobs call this. Splitting them keeps one implementation of the query rather
 * than letting the brief drift away from what the UI shows.
 */
export async function loadIndustryMomentum(): Promise<IndustryMomentum> {
  const latest = await db.industrySentimentSnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) return { date: null, industries: [], subIndustries: [] };

  const [industries, subIndustries] = await Promise.all([
    loadIndustrySentimentRows(latest.date),
    getRankedSubIndustrySentiment(latest.date),
  ]);

  return {
    date: latest.date.toISOString().slice(0, 10),
    industries,
    subIndustries: subIndustries.map((s) => ({
      key: s.key,
      industrySlug: s.industrySlug,
      industryName: s.industryName,
      industryNameZh: s.industryNameZh,
      subIndustry: s.subIndustry,
      subIndustryZh: s.subIndustryZh,
      tickers: s.tickers,
      sentimentScore: s.sentimentScore,
      scoreDelta: s.scoreDelta,
      rank: s.rank,
      previousRank: s.previousRank,
      rankDelta: s.rankDelta,
      status: s.status,
      advancingCount: s.advancingCount,
      flatCount: s.flatCount,
      decliningCount: s.decliningCount,
      stockCount: s.stockCount,
      advancingSharePct: s.advancingSharePct,
      averageReturnPct: s.averageReturnPct,
      volumeRatio: s.volumeRatio,
      breakoutCount: s.breakoutCount,
      foreignNet: s.foreignNet,
      trustNet: s.trustNet,
      dealerNet: s.dealerNet,
      relativeStrengthPct: s.relativeStrengthPct,
      flowSource: s.flowSource,
    })),
  };
}

/** Industry sentiment rows for one session, ordered best-to-worst by rank. */
export async function getIndustrySentimentRows(date: Date): Promise<IndustrySentimentRow[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  return loadIndustrySentimentRows(date);
}

/** Uncached counterpart, for job scripts. See loadIndustryMomentum. */
export async function loadIndustrySentimentRows(date: Date): Promise<IndustrySentimentRow[]> {
  const snapshots = await db.industrySentimentSnapshot.findMany({
    where: { date },
    orderBy: { rank: "asc" },
    include: {
      industry: {
        include: {
          scores: { orderBy: { date: "desc" }, take: 1 },
          sentiment: { where: { date: { lte: date } }, orderBy: { date: "desc" }, take: TREND_SESSIONS },
        },
      },
    },
  });

  return snapshots.map((s) => {
    // `sentiment` is newest-first and includes today, so [1] is the previous
    // session — the same row `previousRank` was resolved against.
    const history = [...s.industry.sentiment].reverse();
    const previous = s.industry.sentiment[1] ?? null;
    const heatScore = s.industry.scores[0]?.totalScore ?? 0;

    return {
      id: s.industryId,
      slug: s.industry.slug,
      name: s.industry.name,
      nameZh: s.industry.nameZh,
      date: s.date.toISOString().slice(0, 10),

      sentimentScore: s.sentimentScore,
      scoreDelta: previous ? Math.round((s.sentimentScore - previous.sentimentScore) * 10) / 10 : 0,
      components: {
        advancingRatio: s.advancingRatio,
        averageReturn: s.averageReturn,
        volumeExpansion: s.volumeExpansion,
        breakoutRatio: s.breakoutRatio,
        institutionalFlowScore: s.institutionalFlowScore,
        relativeStrengthScore: s.relativeStrengthScore,
      },

      rank: s.rank,
      previousRank: s.previousRank,
      rank5dAgo: s.rank5dAgo,
      rankDelta: s.rankDelta,
      status: s.status as SentimentStatus,

      advancingCount: s.advancingCount,
      flatCount: s.flatCount,
      decliningCount: s.decliningCount,
      stockCount: s.stockCount,
      advancingSharePct: s.advancingSharePct,
      averageReturnPct: s.averageReturnPct,
      volumeRatio: s.volumeRatio,
      breakoutCount: s.breakoutCount,
      foreignNet: s.foreignNet,
      trustNet: s.trustNet,
      dealerNet: s.dealerNet,
      relativeStrengthPct: s.relativeStrengthPct,

      sentimentTrend: history.map((h) => h.sentimentScore),
      rankTrend: history.map((h) => h.rank),

      flowSource: sentimentComponentParticipated(s.weightsSnapshot, "institutionalFlowWeight")
        ? "industry"
        : "none",

      heatScore,
      quadrant: classifyQuadrant(s.sentimentScore, heatScore),
    };
  });
}

// ---------------------------------------------------------------------------
// Industry Detail panel
// ---------------------------------------------------------------------------

export interface IndustrySentimentPanel extends IndustrySentimentRow {
  /** How many industries were ranked on this session — makes "#3" readable. */
  universeSize: number;
}

/** The 短線氣氛 panel on an industry detail page. Returns null when no
 *  snapshot exists yet, so the page can show a "run the job" hint rather than
 *  invented zeros. */
export async function getIndustrySentimentPanel(slug: string): Promise<IndustrySentimentPanel | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  const industry = await db.industry.findUnique({ where: { slug }, select: { id: true } });
  if (!industry) return null;

  const latest = await db.industrySentimentSnapshot.findFirst({
    where: { industryId: industry.id },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;

  const [rows, universeSize] = await Promise.all([
    getIndustrySentimentRows(latest.date),
    db.industrySentimentSnapshot.count({ where: { date: latest.date } }),
  ]);

  const row = rows.find((r) => r.id === industry.id);
  return row ? { ...row, universeSize } : null;
}

// ---------------------------------------------------------------------------
// Daily Brief highlights
// ---------------------------------------------------------------------------

export interface SentimentBriefHighlights {
  date: string | null;
  /** Largest positive day-over-day sentiment changes. */
  fastestRising: IndustrySentimentRow[];
  /** Largest negative day-over-day sentiment changes. */
  fastestFalling: IndustrySentimentRow[];
  /** Largest upward rank jumps. */
  biggestRankJumps: IndustrySentimentRow[];
  strongClusters: IndustrySentimentRow[];
  overheated: IndustrySentimentRow[];
}

/**
 * The five groupings the Daily Brief reports on (spec §12). Computed here
 * rather than in the brief job so the API, the brief, and any future alert
 * rule all agree on what "fastest rising" means.
 */
export async function getSentimentBriefHighlights(limit = 3): Promise<SentimentBriefHighlights> {
  "use cache";
  cacheLife("days");
  cacheTag(CACHE_TAGS.radarData);
  return loadSentimentBriefHighlights(limit);
}

/** Uncached counterpart, for job scripts. See loadIndustryMomentum. */
export async function loadSentimentBriefHighlights(limit = 3): Promise<SentimentBriefHighlights> {
  const latest = await db.industrySentimentSnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) {
    return { date: null, fastestRising: [], fastestFalling: [], biggestRankJumps: [], strongClusters: [], overheated: [] };
  }

  const rows = await loadIndustrySentimentRows(latest.date);

  return {
    date: latest.date.toISOString().slice(0, 10),
    fastestRising: [...rows].filter((r) => r.scoreDelta > 0).sort((a, b) => b.scoreDelta - a.scoreDelta).slice(0, limit),
    fastestFalling: [...rows].filter((r) => r.scoreDelta < 0).sort((a, b) => a.scoreDelta - b.scoreDelta).slice(0, limit),
    biggestRankJumps: [...rows].filter((r) => r.rankDelta > 0).sort((a, b) => b.rankDelta - a.rankDelta).slice(0, limit),
    // Strictly 強勢群聚 — accelerating groups are already reported by
    // fastestRising and biggestRankJumps, and listing them here too would put
    // a 加速轉強 row under a 強勢群聚 heading.
    strongClusters: rows.filter((r) => r.status === "strong_cluster"),
    overheated: rows.filter((r) => r.status === "overheated"),
  };
}

// ---------------------------------------------------------------------------
// Table row projection
//
// The 多方 / 空方 / 細產業 tabs render the SAME nine columns over two
// different row shapes, so both are projected onto one flat view model here
// rather than the table growing a union type and a branch per cell.
// ---------------------------------------------------------------------------

export interface MomentumTableRow {
  key: string;
  /** Watchable industry id — null for sub-industry rows, which are a derived
   *  grouping rather than a stored entity. */
  industryId: string | null;
  label: string;
  sublabel: string | null;
  href: string;

  averageReturnPct: number;
  sentimentScore: number;
  scoreDelta: number;

  advancingCount: number;
  flatCount: number;
  decliningCount: number;
  stockCount: number;

  volumeRatio: number;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  flowSource: string;
  relativeStrengthPct: number;
  breakoutCount: number;

  rank: number;
  previousRank: number | null;
  rankDelta: number;
  status: SentimentStatus;
  /** Oldest-first sentiment history; empty for sub-industry rows, which are
   *  not persisted and therefore have no stored trend. */
  sentimentTrend: number[];
}

export function industryToTableRow(r: IndustrySentimentRow): MomentumTableRow {
  return {
    key: r.slug,
    industryId: r.id,
    label: r.nameZh ?? r.name,
    sublabel: r.name,
    href: `/industries/${r.slug}`,
    averageReturnPct: r.averageReturnPct,
    sentimentScore: r.sentimentScore,
    scoreDelta: r.scoreDelta,
    advancingCount: r.advancingCount,
    flatCount: r.flatCount,
    decliningCount: r.decliningCount,
    stockCount: r.stockCount,
    volumeRatio: r.volumeRatio,
    foreignNet: r.foreignNet,
    trustNet: r.trustNet,
    dealerNet: r.dealerNet,
    flowSource: r.flowSource,
    relativeStrengthPct: r.relativeStrengthPct,
    breakoutCount: r.breakoutCount,
    rank: r.rank,
    previousRank: r.previousRank,
    rankDelta: r.rankDelta,
    status: r.status,
    sentimentTrend: r.sentimentTrend,
  };
}

export function subIndustryToTableRow(r: SubIndustrySentimentRow): MomentumTableRow {
  return {
    key: r.key,
    industryId: null,
    label: r.subIndustryZh,
    sublabel: r.industryNameZh ?? r.industryName,
    href: `/industries/${r.industrySlug}`,
    averageReturnPct: r.averageReturnPct,
    sentimentScore: r.sentimentScore,
    scoreDelta: r.scoreDelta,
    advancingCount: r.advancingCount,
    flatCount: r.flatCount,
    decliningCount: r.decliningCount,
    stockCount: r.stockCount,
    volumeRatio: r.volumeRatio,
    foreignNet: r.foreignNet,
    trustNet: r.trustNet,
    dealerNet: r.dealerNet,
    flowSource: r.flowSource,
    relativeStrengthPct: r.relativeStrengthPct,
    breakoutCount: r.breakoutCount,
    rank: r.rank,
    previousRank: r.previousRank,
    rankDelta: r.rankDelta,
    status: r.status,
    sentimentTrend: [],
  };
}
