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
import { NotPublishedError } from "@/lib/providers/errors";
import type { MarketStatusResult } from "@/lib/providers/types";
import { classifyStockTechnicals, deriveStockStatus, persistIndustryScoresForDate } from "@/lib/jobs/compute-scores";
import { persistIndustrySentimentForDate } from "@/lib/jobs/compute-sentiment";
import {
  aggregateIndustryFlows,
  ensureDataSource,
  writeCatalysts,
  writeFundamentals,
  writeIndicatorValues,
  writeIndustryFlows,
  writeMarketData,
  writeMarketScopeFlows,
  writeMarketStatus,
  writeStockFlows,
  type TrackedStock,
} from "@/lib/jobs/persist";
import { attributeTo, type DatasetOutcome } from "@/lib/jobs/run-log";
import { sessionCloseAt } from "@/lib/jobs/sessions";
import { utcDay, utcDateKey } from "@/lib/dates";

/**
 * The per-dataset steps of the after-hours pipeline. Each one does ONE
 * dataset for ONE session and reports what it got in a DatasetOutcome; the
 * order, the retries and the "is this session finished" question live in
 * session-plan.ts, and pipeline.ts wires the two together.
 *
 * Every step targets an explicit session — the newest the exchange has
 * PUBLISHED, resolved once per run — instead of whatever date each feed
 * happens to serve. Two feeds disagreeing about the latest session is normal
 * for a few hours every evening (TPEx ahead of the TWSE mirror, T86 behind the
 * close), and a pipeline that took each feed's own date would store prices for
 * one exchange under a session the other has not published, then score it.
 * Rows a feed returns for any other date are therefore ignored, not written.
 *
 * A step never reports success for nothing: a feed that has not published the
 * session throws NotPublishedError (recorded as `waiting` and retried on the
 * next poll), and a dataset that landed short of complete is `partial`.
 */

export interface SessionContext {
  /** UTC-midnight storage key of the target session. */
  session: Date;
  stocks: TrackedStock[];
}

export interface StepResult<T = unknown> {
  value: T;
  outcome: DatasetOutcome;
}

/** Share of tracked stocks that must have a price before the session can be scored.
 *  Not 100%: a suspended stock legitimately has no bar for the day. */
export const PRICE_COMPLETE_RATIO = 0.95;
/** Share of priced stocks that must have a flow row. Lower than prices because
 *  a stock no institution traded that day can be absent from T86. */
export const FLOW_COMPLETE_RATIO = 0.8;

const isoDay = utcDateKey;
const sameSession = (date: Date, session: Date) => utcDay(date).getTime() === session.getTime();
const joinKeys = (keys: string[]) => (keys.length ? [...new Set(keys)].join(",") : null);

/** One provider's request; whatever it throws is attributed to that provider's DataSource key. */
async function ask<T>(provider: { source: { key: string } }, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    throw attributeTo(err, provider.source.key);
  }
}

// ---------------------------------------------------------------------------
// Market status (TAIEX close, breadth, market-level institutional net, margin)
// ---------------------------------------------------------------------------

export async function refreshMarketStatus(ctx: SessionContext): Promise<StepResult> {
  const day = isoDay(ctx.session);

  // Mock mode registers no market-status provider: the seeded row is the data.
  if (!marketStatusProviders.length) {
    const row = await db.marketStatus.findUnique({ where: { date: ctx.session }, select: { close: true } });
    if (!row) throw new Error(`no market-status provider in ${dataMode} mode and no stored row for ${day}`);
    return { value: { stored: true }, outcome: { expected: 1, sourceAsOf: sessionCloseAt(ctx.session) } };
  }

  let received = 0;
  let persisted = 0;
  const providers: string[] = [];
  const missing = new Set<string>();
  for (const provider of marketStatusProviders) {
    // fetchRange pins the session; fetchLatest would let the feed pick it.
    const results = await ask(provider, () =>
      provider.fetchRange ? provider.fetchRange(ctx.session, ctx.session) : provider.fetchLatest(),
    );
    const forSession = results.filter((r) => sameSession(r.date, ctx.session));
    if (!forSession.length) throw new NotPublishedError(provider.source.key, day);

    // Registered after the fetch, so DataSource.updatedAt moves only when the
    // source actually answered.
    const sourceId = await ensureDataSource(provider.source);
    persisted += await writeMarketStatus(forSession, provider.source.isMock);
    await writeMarketScopeFlows(forSession, sourceId, provider.source.isMock);
    received += forSession.length;
    providers.push(provider.source.key);
    for (const r of forSession) for (const field of missingDetail(r)) missing.add(field);
  }

  return {
    value: { received, missing: [...missing] },
    outcome: {
      // The writer leaves an unfetched field untouched rather than zeroing it,
      // so asking again for the missing detail is safe.
      status: missing.size ? "partial" : "success",
      received,
      persisted,
      expected: 1,
      provider: joinKeys(providers),
      sourceAsOf: sessionCloseAt(ctx.session),
      note: missing.size ? `not published yet: ${[...missing].join(", ")}` : null,
    },
  };
}

function missingDetail(r: MarketStatusResult): string[] {
  const out: string[] = [];
  if (r.breadthAdvancers === null || r.breadthDecliners === null) out.push("breadth");
  if (r.foreignNet === null || r.trustNet === null || r.dealerNet === null) out.push("market institutional net");
  if (r.marginChange === null) out.push("margin");
  return out;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface PriceCoverage {
  priced: number;
  tracked: number;
  missingExchanges: string[];
  complete: boolean;
}

/**
 * How much of the session is stored — across every run, not just this one,
 * since an earlier poll may already have written one exchange.
 *
 * Both exchanges are required, not just a share of the stocks: TPEx publishes
 * ahead of the TWSE mirror, and a session scored off one exchange's prices is
 * a different market from the one the industry pages describe.
 */
export async function priceCoverage(session: Date, stocks: TrackedStock[]): Promise<PriceCoverage> {
  const rows = await db.marketData.findMany({ where: { date: session }, select: { stockId: true } });
  const exchangeById = new Map(stocks.map((s) => [s.id, s.exchange] as const));
  const present = new Set<string>();
  let priced = 0;
  for (const row of rows) {
    const exchange = exchangeById.get(row.stockId);
    if (exchange === undefined) continue;
    present.add(exchange);
    priced++;
  }
  const missingExchanges = [...new Set(stocks.map((s) => s.exchange))].filter((e) => !present.has(e)).sort();
  return {
    priced,
    tracked: stocks.length,
    missingExchanges,
    complete: stocks.length > 0 && priced >= stocks.length * PRICE_COMPLETE_RATIO && missingExchanges.length === 0,
  };
}

async function sessionPriceSources(session: Date): Promise<string[]> {
  const rows = await db.marketData.findMany({
    where: { date: session, dataSourceId: { not: null } },
    select: { dataSource: { select: { key: true } } },
    distinct: ["dataSourceId"],
  });
  return rows.map((r) => r.dataSource?.key).filter((k): k is string => !!k);
}

export async function refreshPrices(ctx: SessionContext): Promise<StepResult<PriceCoverage>> {
  const day = isoDay(ctx.session);
  let received = 0;
  let persisted = 0;
  const providers: string[] = [];
  const otherDates = new Set<string>();

  for (const provider of marketDataProviders) {
    providers.push(provider.source.key);
    const quotes = await ask(provider, () => provider.fetchLatest(ctx.stocks));
    const forSession = quotes.filter((q) => sameSession(q.date, ctx.session));
    for (const q of quotes) if (!sameSession(q.date, ctx.session)) otherDates.add(isoDay(q.date));
    if (!forSession.length) continue;
    const sourceId = await ensureDataSource(provider.source);
    persisted += await writeMarketData(forSession, ctx.stocks, sourceId, provider.source.isMock);
    received += forSession.length;
  }
  if (otherDates.size) {
    console.warn(`[refresh] prices: ignored quotes dated ${[...otherDates].sort().join(", ")} (target session ${day})`);
  }

  const coverage = await priceCoverage(ctx.session, ctx.stocks);
  if (coverage.priced === 0) {
    if (marketDataProviders.length) {
      throw new NotPublishedError(
        providers.join(","),
        day,
        `no ${day} prices published yet` + (otherDates.size ? ` (feeds still serve ${[...otherDates].sort().join(", ")})` : ""),
      );
    }
    throw new Error(`no price provider in ${dataMode} mode and no stored prices for ${day}`);
  }
  // Mock mode fetches nothing: name the source the stored rows came from.
  if (!providers.length) providers.push(...(await sessionPriceSources(ctx.session)));

  const shortfall = [
    coverage.priced < coverage.tracked * PRICE_COMPLETE_RATIO
      ? `${coverage.priced}/${coverage.tracked} tracked stocks priced (need ${Math.round(PRICE_COMPLETE_RATIO * 100)}%)`
      : null,
    coverage.missingExchanges.length ? `no ${coverage.missingExchanges.join(" / ")} prices yet` : null,
  ].filter(Boolean);

  return {
    value: coverage,
    outcome: {
      status: coverage.complete ? "success" : "partial",
      received,
      persisted,
      expected: coverage.tracked,
      provider: joinKeys(providers),
      sourceAsOf: sessionCloseAt(ctx.session),
      note: shortfall.join("; ") || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Institutional flows
// ---------------------------------------------------------------------------

export interface FlowCoverage {
  stockRows: number;
  industryRows: number;
  /** What a complete session needs: priced stocks (stock scope) or industries (industry scope). */
  expected: number;
  missingExchanges: string[];
  complete: boolean;
}

/**
 * @param perStock the feed reports per stock (live) rather than per industry
 *   (the mock generator) — coverage is measured at the scope the feed fills.
 */
async function flowCoverage(session: Date, stocks: TrackedStock[], perStock: boolean): Promise<FlowCoverage> {
  const [stockFlows, industryRows, industries, priced] = await Promise.all([
    db.institutionalFlow.findMany({ where: { scope: "stock", date: session }, select: { stockId: true }, distinct: ["stockId"] }),
    db.institutionalFlow.count({ where: { scope: "industry", date: session } }),
    db.industry.count({ where: { stocks: { some: {} } } }),
    db.marketData.findMany({ where: { date: session }, select: { stockId: true } }),
  ]);

  if (!perStock) {
    return {
      stockRows: 0,
      industryRows,
      expected: industries,
      missingExchanges: [],
      complete: industries > 0 && industryRows >= industries * FLOW_COMPLETE_RATIO,
    };
  }

  const exchangeById = new Map(stocks.map((s) => [s.id, s.exchange] as const));
  const exchangesOf = (ids: Array<string | null>) =>
    new Set(ids.map((id) => (id ? exchangeById.get(id) : undefined)).filter((e): e is string => !!e));
  const flowExchanges = exchangesOf(stockFlows.map((f) => f.stockId));
  const missingExchanges = [...exchangesOf(priced.map((p) => p.stockId))].filter((e) => !flowExchanges.has(e)).sort();
  return {
    stockRows: stockFlows.length,
    industryRows,
    expected: priced.length,
    missingExchanges,
    complete: stockFlows.length >= priced.length * FLOW_COMPLETE_RATIO && missingExchanges.length === 0,
  };
}

/**
 * @param lastCall the attempt at or after PIPELINE_FLOW_DEADLINE. "Not
 *   published" then stops being something to wait for and becomes a failure,
 *   which lets scores, sentiment, alerts and the brief finalize without flows.
 */
export async function refreshFlows(ctx: SessionContext, lastCall: boolean, deadline: string): Promise<StepResult<FlowCoverage>> {
  const day = isoDay(ctx.session);
  const missedDeadline = (source: string) => new Error(`${source} had not published ${day} flows by the ${deadline} deadline`);

  let received = 0;
  let persisted = 0;
  let perStock = false;
  const delivered: string[] = [];
  const pending: string[] = [];

  for (const provider of institutionalFlowProviders) {
    let results;
    try {
      // fetchForDate pins the session the prices were just stored for; the
      // per-stock rows are valued at that session's close.
      results = provider.fetchForDate
        ? await provider.fetchForDate(ctx.stocks, ctx.session)
        : await provider.fetchLatest(ctx.stocks);
    } catch (err) {
      const raised = lastCall && err instanceof NotPublishedError ? missedDeadline(provider.source.key) : err;
      throw attributeTo(raised, provider.source.key);
    }
    const forSession = results.filter((r) => sameSession(r.date, ctx.session));
    if (!forSession.length) {
      pending.push(provider.source.key);
      continue;
    }

    const sourceId = await ensureDataSource(provider.source);
    const stockScope = forSession.filter((r) => r.scope === "stock");
    const industryScope = forSession.filter((r) => r.scope === "industry");
    if (stockScope.length) perStock = true;
    persisted += await writeStockFlows(stockScope, ctx.stocks, sourceId, provider.source.isMock);
    // The mock generator still reports industries directly; the live feed
    // reports stocks, which are rolled up here.
    persisted += industryScope.length
      ? await writeIndustryFlows(industryScope, sourceId, provider.source.isMock)
      : await aggregateIndustryFlows(ctx.session, sourceId, provider.source.isMock);
    received += forSession.length;
    delivered.push(provider.source.key);
  }

  if (!delivered.length) {
    if (!institutionalFlowProviders.length) throw new Error(`no institutional-flow provider in ${dataMode} mode`);
    const source = pending.join(",");
    throw attributeTo(lastCall ? missedDeadline(source) : new NotPublishedError(source, day), source);
  }

  const coverage = await flowCoverage(ctx.session, ctx.stocks, perStock);
  const shortfall = [
    pending.length ? `not published yet by ${pending.join(", ")}` : null,
    !coverage.complete && !coverage.missingExchanges.length
      ? `${coverage.stockRows || coverage.industryRows}/${coverage.expected} rows (need ${Math.round(FLOW_COMPLETE_RATIO * 100)}%)`
      : null,
    coverage.missingExchanges.length ? `no ${coverage.missingExchanges.join(" / ")} flows yet` : null,
    lastCall && !coverage.complete ? `final: ${deadline} deadline passed` : null,
  ].filter(Boolean);

  return {
    value: coverage,
    outcome: {
      status: coverage.complete && !pending.length ? "success" : "partial",
      received,
      persisted,
      expected: coverage.expected,
      provider: joinKeys(delivered),
      sourceAsOf: sessionCloseAt(ctx.session),
      note: shortfall.join("; ") || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Best-effort datasets: not published per session, never block one
// ---------------------------------------------------------------------------

const noProvider = (what: string): StepResult => ({
  value: null,
  outcome: { status: "skipped", note: `no ${what} provider in ${dataMode} mode` },
});

export async function refreshFundamentals(ctx: SessionContext): Promise<StepResult> {
  if (!fundamentalProviders.length) return noProvider("fundamentals");
  let received = 0;
  let persisted = 0;
  const providers: string[] = [];
  for (const provider of fundamentalProviders) {
    const results = await ask(provider, () => provider.fetchLatest(ctx.stocks));
    await ensureDataSource(provider.source);
    persisted += await writeFundamentals(results, ctx.stocks, provider.source.isMock);
    received += results.length;
    providers.push(provider.source.key);
  }
  return {
    value: { received, persisted },
    outcome: {
      // Every listed company files monthly revenue; an empty pull is a feed
      // problem, not a quiet month.
      status: received ? "success" : "partial",
      received,
      persisted,
      expected: ctx.stocks.length,
      provider: joinKeys(providers),
      note: received ? null : "provider returned no rows",
    },
  };
}

export async function refreshCatalysts(ctx: SessionContext): Promise<StepResult> {
  if (!newsProviders.length) return noProvider("catalyst");
  let received = 0;
  let persisted = 0;
  const providers: string[] = [];
  let newest: Date | null = null;
  for (const provider of newsProviders) {
    const results = await ask(provider, () => provider.fetchLatest(ctx.stocks));
    const sourceId = await ensureDataSource(provider.source);
    persisted += await writeCatalysts(results, ctx.stocks, sourceId, provider.source.isMock);
    received += results.length;
    providers.push(provider.source.key);
    for (const r of results) if (!newest || r.date > newest) newest = r.date;
  }
  // Zero material announcements is a normal day, so an empty pull is success.
  return {
    value: { received, persisted },
    outcome: { received, persisted, provider: joinKeys(providers), sourceAsOf: newest },
  };
}

export async function refreshIndicators(): Promise<StepResult> {
  if (!indicatorProviders.length) return noProvider("indicator");
  let received = 0;
  let persisted = 0;
  const providers: string[] = [];
  let newest: Date | null = null;
  for (const provider of indicatorProviders) {
    const results = await ask(provider, () => provider.fetchLatest());
    const sourceId = await ensureDataSource(provider.source);
    persisted += await writeIndicatorValues(results, sourceId, provider.source.isMock);
    received += results.length;
    providers.push(provider.source.key);
    for (const r of results) if (!newest || r.date > newest) newest = r.date;
  }
  return {
    value: { received, persisted },
    outcome: {
      status: received ? "success" : "partial",
      received,
      persisted,
      provider: joinKeys(providers),
      sourceAsOf: newest,
      note: received ? null : "providers returned no values",
    },
  };
}

// ---------------------------------------------------------------------------
// Derived datasets
// ---------------------------------------------------------------------------

export async function refreshTechnicals(ctx: SessionContext): Promise<StepResult> {
  const result = await recomputeTechnicals(ctx.session);
  return {
    value: result,
    outcome: {
      status: result.statuses ? "success" : "failed",
      persisted: result.statuses,
      expected: ctx.stocks.length,
      note: result.statuses ? null : "no stock had enough price history to classify",
    },
  };
}

/**
 * @param provisional flows for the session are still pending. The scores are
 *   computed anyway — the formulas already drop a component that has no data
 *   for the session — but recorded as `partial`, so the planner recomputes
 *   them once flows land and holds alerts and the brief until then.
 */
export async function refreshScores(ctx: SessionContext, provisional: boolean): Promise<StepResult> {
  const written = await persistIndustryScoresForDate(ctx.session);
  return { value: { written }, outcome: derivedOutcome(written, provisional) };
}

export async function refreshSentiment(ctx: SessionContext, provisional: boolean): Promise<StepResult> {
  const written = await persistIndustrySentimentForDate(ctx.session);
  return { value: { written }, outcome: derivedOutcome(written, provisional) };
}

function derivedOutcome(written: number, provisional: boolean): DatasetOutcome {
  if (!written) return { status: "failed", note: "computed 0 rows" };
  return {
    status: provisional ? "partial" : "success",
    persisted: written,
    expected: written,
    note: provisional ? "flows waiting: computed without the session's institutional flow" : null,
  };
}

// ---------------------------------------------------------------------------
// Transitional API
// ---------------------------------------------------------------------------
// scripts/cron.ts still imports the pre-pipeline gate and refresh entry point
// on this branch; it moves to runDailyPipeline in a separate change. These keep
// it compiling and route it through the planned, locked, logged pipeline.
// Delete both once nothing imports them.

/** @deprecated Use runDailyPipeline, which decides per dataset what is missing. */
export async function latestPublishedSessionStored(): Promise<boolean> {
  const { pipelineHasWork } = await import("./pipeline");
  return !(await pipelineHasWork());
}

/** @deprecated Use runDailyPipeline({ job: "refresh" }). */
export async function runRefreshJob() {
  const { runDailyPipeline } = await import("./pipeline");
  return runDailyPipeline({ trigger: "scheduler", job: "refresh" });
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

    // Every matching row, not just the first: the identity is not unique in
    // the database (see writeFlowRow in persist.ts).
    for (const flow of industry.flows) {
      await db.institutionalFlow.update({ where: { id: flow.id }, data: { breakoutCount: industryBreakouts } });
    }
    breakouts += industryBreakouts;
  }

  return { breakouts, statuses };
}
