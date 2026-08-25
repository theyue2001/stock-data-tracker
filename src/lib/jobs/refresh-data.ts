import { db } from "@/lib/db";
import { indicatorProviders, institutionalFlowProviders } from "@/lib/providers/registry";
import { classifyStockTechnicals, deriveStockStatus, persistIndustryScoresForDate } from "@/lib/jobs/compute-scores";
import { persistIndustrySentimentForDate } from "@/lib/jobs/compute-sentiment";
import { utcDay } from "@/lib/dates";

/**
 * Pulls every registered provider, writes the results, then recomputes
 * today's IndustryScore rows from the freshly stored data via the shared
 * derivation in compute-scores.ts.
 */
export async function runRefreshJob(referenceDate: Date = new Date()) {
  const today = utcDay(referenceDate);
  const summary = { indicatorValues: 0, flows: 0, breakouts: 0, statuses: 0, scores: 0, sentiment: 0 };

  // --- 1. Pull indicator providers ----------------------------------------
  for (const provider of indicatorProviders) {
    const source = await db.dataSource.findUnique({ where: { key: "mock-indicator" } });
    const results = await provider.fetchLatest();

    for (const r of results) {
      const indicator = await db.indicator.findFirst({ where: { key: r.indicatorKey } });
      if (!indicator) continue;

      const prev = await db.indicatorValue.findFirst({
        where: { indicatorId: indicator.id, date: { lt: utcDay(r.date) } },
        orderBy: { date: "desc" },
      });
      const pctChange = prev ? ((r.value - prev.value) / prev.value) * 100 : null;
      const date = utcDay(r.date);

      await db.indicatorValue.upsert({
        where: { indicatorId_date: { indicatorId: indicator.id, date } },
        create: {
          indicatorId: indicator.id,
          date,
          value: r.value,
          previousValue: prev?.value ?? null,
          pctChange,
          sourceUrl: r.sourceUrl,
          dataSourceId: source?.id,
          dataTimestamp: r.date,
          isMock: true,
        },
        update: {
          value: r.value,
          previousValue: prev?.value ?? null,
          pctChange,
          dataTimestamp: r.date,
        },
      });
      summary.indicatorValues++;
    }
  }

  // --- 2. Pull institutional flow providers -------------------------------
  for (const provider of institutionalFlowProviders) {
    const source = await db.dataSource.findUnique({ where: { key: "mock-flow" } });
    const results = await provider.fetchLatest();

    for (const r of results) {
      const industry = r.industryKey ? await db.industry.findUnique({ where: { slug: r.industryKey } }) : null;
      if (r.scope === "industry" && !industry) continue;

      const date = utcDay(r.date);
      const existing = await db.institutionalFlow.findFirst({
        where: { scope: r.scope, industryId: industry?.id ?? null, date },
      });

      const data = {
        date,
        scope: r.scope,
        industryId: industry?.id ?? null,
        foreignNet: r.foreignNet,
        trustNet: r.trustNet,
        dealerNet: r.dealerNet,
        marginChange: r.marginChange,
        turnover: r.turnover,
        volumeChangePct: r.volumeChangePct,
        dataSourceId: source?.id,
        isMock: true,
      };

      if (existing) await db.institutionalFlow.update({ where: { id: existing.id }, data });
      else await db.institutionalFlow.create({ data });
      summary.flows++;
    }
  }

  // --- 3. Recompute technicals, statuses, and breakout counts --------------
  // A real institutional-flow feed reports net buying, not chart patterns, so
  // breakout counts are derived here rather than trusted from the provider.
  const technicals = await recomputeTechnicals(today);
  summary.breakouts = technicals.breakouts;
  summary.statuses = technicals.statuses;

  // --- 4. Recompute today's industry scores -------------------------------
  // Delegated to the shared derivation so backfilled history and today's
  // score are always produced by the same formula.
  summary.scores = await persistIndustryScoresForDate(today);

  // --- 5. Recompute today's industry sentiment snapshots -------------------
  // Runs AFTER the flow writes above, since the Institutional Flow component
  // reads the same rows step 2 just persisted. Ranking and status resolve
  // against the previous session's snapshot, so this must also run after any
  // backfill has established that history.
  summary.sentiment = await persistIndustrySentimentForDate(today);

  return summary;
}

/**
 * Recomputes per-stock technicals, the stored status label, and the
 * industry-level breakout count, all from the same price series. Keeping these
 * in one pass guarantees the badge on a stock row and the count on its
 * industry card can never disagree.
 */
async function recomputeTechnicals(asOf: Date): Promise<{ breakouts: number; statuses: number }> {
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
