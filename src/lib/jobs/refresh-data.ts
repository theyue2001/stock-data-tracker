import { db } from "@/lib/db";
import {
  dataMode,
  fundamentalProviders,
  indicatorProviders,
  institutionalFlowProviders,
  marketDataProviders,
  marketStatusProviders,
  newsProviders,
} from "@/lib/providers/registry";
import { classifyStockTechnicals, deriveStockStatus, persistIndustryScoresForDate } from "@/lib/jobs/compute-scores";
import { persistIndustrySentimentForDate } from "@/lib/jobs/compute-sentiment";
import {
  aggregateIndustryFlows,
  ensureDataSource,
  loadTrackedStocks,
  writeCatalysts,
  writeFundamentals,
  writeIndicatorValues,
  writeMarketData,
  writeMarketScopeFlows,
  writeMarketStatus,
  writeStockFlows,
} from "@/lib/jobs/persist";
import { utcDay } from "@/lib/dates";

export interface RefreshSummary {
  mode: string;
  /** The session the pipeline actually computed for. */
  session: string | null;
  marketStatus: number;
  quotes: number;
  fundamentals: number;
  catalysts: number;
  stockFlows: number;
  industryFlows: number;
  indicatorValues: number;
  breakouts: number;
  statuses: number;
  scores: number;
  sentiment: number;
  /**
   * Wall-clock milliseconds per step.
   *
   * This job has to finish inside a serverless function's time limit, and that
   * limit is enforced on the total — so the moment the total gets close, the
   * only question worth answering is which step is responsible. Guessing at it
   * from the outside already cost one wrong optimisation here (the throttled
   * TWSE host was assumed to dominate; it does not).
   */
  timings: Record<string, number>;
}

/**
 * Pulls every registered provider, writes the results, then recomputes
 * technicals, industry scores and sentiment from the freshly stored data.
 *
 * The pipeline computes for the LATEST PUBLISHED SESSION rather than for the
 * wall-clock date. Taiwan closes at 13:30 and publishes after-hours reports
 * through the evening, so a job that assumed "today" would compute an empty
 * session every weekend and holiday, and a half-empty one any time it ran
 * before publication — writing zero-flow rows over good data.
 *
 * Order matters and is not incidental:
 *   prices -> flows      (per-stock net buying is published in shares and has
 *                         to be valued at the session close)
 *   revenue -> indicators (the ODM aggregate is derived from stored filings)
 *   everything -> scores  (both scoring passes read only what is stored)
 */
export async function runRefreshJob(referenceDate: Date = new Date()): Promise<RefreshSummary> {
  const stocks = await loadTrackedStocks();
  const summary: RefreshSummary = {
    mode: dataMode,
    session: null,
    marketStatus: 0,
    quotes: 0,
    fundamentals: 0,
    catalysts: 0,
    stockFlows: 0,
    industryFlows: 0,
    indicatorValues: 0,
    breakouts: 0,
    statuses: 0,
    scores: 0,
    sentiment: 0,
    timings: {},
  };

  let mark = Date.now();
  /** Attributes the time since the previous lap to `name`. */
  const lap = (name: string) => {
    const now = Date.now();
    summary.timings[name] = now - mark;
    mark = now;
  };

  // --- 1. Market status (TAIEX) — also establishes the session date --------
  let session: Date | null = null;
  for (const provider of marketStatusProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const results = await provider.fetchLatest();
    if (!results.length) continue;
    summary.marketStatus += await writeMarketStatus(results, provider.source.isMock);
    await writeMarketScopeFlows(results, sourceId, provider.source.isMock);
    const latest = results.reduce((a, r) => (r.date > a ? r.date : a), results[0].date);
    if (!session || latest > session) session = utcDay(latest);
  }

  lap("marketStatus");

  // --- 2. Prices ------------------------------------------------------------
  for (const provider of marketDataProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const quotes = await provider.fetchLatest(stocks);
    summary.quotes += await writeMarketData(quotes, stocks, sourceId, provider.source.isMock);
    for (const quote of quotes) {
      const day = utcDay(quote.date);
      if (!session || day > session) session = day;
    }
  }

  lap("prices");

  // Fall back to the newest stored session, then to the wall clock, so a
  // provider outage degrades to "recompute what we have" rather than to a
  // crash or to writing a session that does not exist.
  session ??= (await latestStoredSession()) ?? utcDay(referenceDate);
  summary.session = session.toISOString().slice(0, 10);

  // --- 3. Fundamentals ------------------------------------------------------
  for (const provider of fundamentalProviders) {
    await ensureDataSource(provider.source);
    const results = await provider.fetchLatest(stocks);
    summary.fundamentals += await writeFundamentals(results, stocks, provider.source.isMock);
  }

  lap("fundamentals");

  // --- 4. Catalysts ---------------------------------------------------------
  for (const provider of newsProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const results = await provider.fetchLatest(stocks);
    summary.catalysts += await writeCatalysts(results, stocks, sourceId, provider.source.isMock);
  }

  lap("catalysts");

  // --- 5. Institutional flow ------------------------------------------------
  for (const provider of institutionalFlowProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const results = await provider.fetchLatest(stocks);
    const stockScope = results.filter((r) => r.scope === "stock");
    summary.stockFlows += await writeStockFlows(stockScope, stocks, sourceId, provider.source.isMock);

    // The mock provider still reports at industry scope directly; the live one
    // reports per stock and is rolled up below.
    const industryScope = results.filter((r) => r.scope === "industry");
    if (industryScope.length) {
      summary.industryFlows += await writeLegacyIndustryFlows(industryScope, sourceId, provider.source.isMock);
    } else {
      summary.industryFlows += await aggregateIndustryFlows(session, sourceId, provider.source.isMock);
    }
  }

  lap("flows");

  // --- 6. Leading indicators ------------------------------------------------
  for (const provider of indicatorProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const results = await provider.fetchLatest();
    summary.indicatorValues += await writeIndicatorValues(results, sourceId, provider.source.isMock);
  }

  lap("indicators");

  // --- 7. Technicals, statuses, breakout counts -----------------------------
  // A real institutional-flow feed reports net buying, not chart patterns, so
  // breakout counts are derived here rather than trusted from the provider.
  const technicals = await recomputeTechnicals(session);
  summary.breakouts = technicals.breakouts;
  summary.statuses = technicals.statuses;

  lap("technicals");

  // --- 8. Industry scores ---------------------------------------------------
  summary.scores = await persistIndustryScoresForDate(session);

  lap("scores");

  // --- 9. Industry sentiment ------------------------------------------------
  // Runs AFTER the flow writes above, since the Institutional Flow component
  // reads the same rows step 5 persisted. Ranking and status resolve against
  // the previous session's snapshot, so this must also run after any backfill
  // has established that history.
  summary.sentiment = await persistIndustrySentimentForDate(session);

  lap("sentiment");

  return summary;
}

/** The newest session already stored, used when every provider comes back
 *  empty (weekend run, feed outage, mock mode with no market provider). */
async function latestStoredSession(): Promise<Date | null> {
  const [status, quote] = await Promise.all([
    db.marketStatus.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    db.marketData.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const dates = [status?.date, quote?.date].filter((d): d is Date => !!d);
  if (!dates.length) return null;
  return utcDay(dates.reduce((a, d) => (d > a ? d : a)));
}

/** Industry-scope rows straight from a provider (the mock generator), kept so
 *  DATA_MODE=mock still produces a complete dataset. */
async function writeLegacyIndustryFlows(
  results: Array<{
    date: Date;
    industryKey?: string;
    foreignNet: number;
    trustNet: number;
    dealerNet: number;
    marginChange: number;
    turnover: number;
    volumeChangePct: number;
  }>,
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  let written = 0;
  for (const r of results) {
    const industry = r.industryKey ? await db.industry.findUnique({ where: { slug: r.industryKey } }) : null;
    if (!industry) continue;
    const date = utcDay(r.date);
    const data = {
      date,
      scope: "industry",
      industryId: industry.id,
      foreignNet: r.foreignNet,
      trustNet: r.trustNet,
      dealerNet: r.dealerNet,
      marginChange: r.marginChange,
      turnover: r.turnover,
      volumeChangePct: r.volumeChangePct,
      dataSourceId,
      isMock,
    };
    const existing = await db.institutionalFlow.findFirst({
      where: { scope: "industry", industryId: industry.id, date },
    });
    if (existing) await db.institutionalFlow.update({ where: { id: existing.id }, data });
    else await db.institutionalFlow.create({ data });
    written++;
  }
  return written;
}

/**
 * Recomputes per-stock technicals, the stored status label, and the
 * industry-level breakout count, all from the same price series. Keeping these
 * in one pass guarantees the badge on a stock row and the count on its
 * industry card can never disagree.
 */
export async function recomputeTechnicals(asOf: Date): Promise<{ breakouts: number; statuses: number }> {
  const marketRows = await db.marketStatus.findMany({
    where: { date: { lte: asOf } },
    orderBy: { date: "desc" },
    take: 60,
  });
  const marketReturn =
    marketRows.length >= 2
      ? ((marketRows[0].close - marketRows[marketRows.length - 1].close) / marketRows[marketRows.length - 1].close) * 100
      : 0;

  const industries = await db.industry.findMany({
    include: {
      stocks: {
        include: {
          marketData: { where: { date: { lte: asOf } }, orderBy: { date: "desc" }, take: 60 },
          fundamentals: { where: { periodType: "monthly_revenue" }, orderBy: { period: "desc" }, take: 1 },
        },
      },
      flows: { where: { scope: "industry", date: asOf } },
    },
  });

  let breakouts = 0;
  let statuses = 0;

  for (const industry of industries) {
    let industryBreakouts = 0;

    for (const stock of industry.stocks) {
      const tech = classifyStockTechnicals(stock.marketData, marketReturn);
      if (!tech) continue;

      if (tech.trend === "breakout") industryBreakouts++;

      const status = deriveStockStatus(tech, stock.fundamentals[0]?.yoyChangePct ?? null);
      await db.stock.update({ where: { id: stock.id }, data: { status } });
      statuses++;

      // The technical flags live on the latest MarketData row.
      const latest = stock.marketData[0];
      if (latest) {
        await db.marketData.update({
          where: { id: latest.id },
          data: {
            technicalTrend: tech.trend,
            relativeStrength: tech.relativeStrength,
            valuationPosition: tech.valuationPosition,
          },
        });
      }
    }

    const flow = industry.flows[0];
    if (flow) {
      await db.institutionalFlow.update({ where: { id: flow.id }, data: { breakoutCount: industryBreakouts } });
    }
    breakouts += industryBreakouts;
  }

  return { breakouts, statuses };
}
