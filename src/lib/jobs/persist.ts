import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { utcDay, utcDayOffset } from "@/lib/dates";
import type {
  FundamentalResult,
  IndicatorResult,
  InstitutionalFlowResult,
  MarketQuote,
  MarketStatusResult,
  NewsCatalystResult,
  ProviderSource,
  StockRef,
} from "@/lib/providers/types";

/**
 * Write helpers shared by the nightly refresh and the history backfill.
 *
 * Both paths must produce byte-identical rows — a backfilled session and a
 * freshly pulled one differ only in when they were fetched, and any
 * divergence in units, provenance or derived fields would show up as a phantom
 * regime change on the exact date the two meet.
 */

export interface TrackedStock extends StockRef {
  id: string;
  industryId: string;
  industrySlug: string;
}

/** Upserts a provider's self-declared provenance and returns its row id. */
export async function ensureDataSource(source: ProviderSource): Promise<string> {
  const row = await db.dataSource.upsert({
    where: { key: source.key },
    create: {
      key: source.key,
      name: source.name,
      category: source.category,
      url: source.url ?? null,
      isMock: source.isMock,
      description: source.description ?? null,
    },
    update: {
      name: source.name,
      category: source.category,
      url: source.url ?? null,
      isMock: source.isMock,
      description: source.description ?? null,
    },
  });
  return row.id;
}

export async function loadTrackedStocks(): Promise<TrackedStock[]> {
  const stocks = await db.stock.findMany({
    select: { id: true, ticker: true, exchange: true, industryId: true, industry: { select: { slug: true } } },
  });
  return stocks.map((s) => ({
    id: s.id,
    ticker: s.ticker,
    exchange: s.exchange,
    industryId: s.industryId,
    industrySlug: s.industry.slug,
  }));
}

// ---------------------------------------------------------------------------
// Market status
// ---------------------------------------------------------------------------

/**
 * Writes TAIEX status rows.
 *
 * Null detail fields are OMITTED from the write rather than coerced to zero:
 * on insert the column takes its schema default, and on update the previously
 * stored value survives. That is what makes the backfill safely re-runnable
 * against a rate-limited source — a run that could not fetch breadth for a
 * session leaves a gap a later run fills, instead of stamping a fabricated
 * zero over it.
 */
export async function writeMarketStatus(results: MarketStatusResult[], isMock: boolean): Promise<number> {
  for (const r of results) {
    const detail = Object.fromEntries(
      Object.entries({
        breadthAdvancers: r.breadthAdvancers,
        breadthDecliners: r.breadthDecliners,
        foreignNet: r.foreignNet,
        trustNet: r.trustNet,
        dealerNet: r.dealerNet,
        marginChange: r.marginChange,
      }).filter(([, v]) => v !== null),
    );

    const data = {
      index: r.index,
      close: r.close,
      change: r.change,
      changePct: round2(r.changePct),
      volume: r.volume,
      ...detail,
      isMock,
    };
    await db.marketStatus.upsert({
      where: { date: utcDay(r.date) },
      create: { date: utcDay(r.date), ...data },
      update: data,
    });
  }
  return results.length;
}

/**
 * Mirrors each MarketStatus row into a market-scope InstitutionalFlow row.
 *
 * The market total is not re-fetched from a second report: deriving it from
 * the row just written is what guarantees the market line on the capital-flow
 * page and the market status header can never quote different numbers for the
 * same session.
 */
export async function writeMarketScopeFlows(
  results: MarketStatusResult[],
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  let written = 0;

  for (const r of results) {
    // A market flow row whose flows were never fetched would be a row of
    // zeros claiming the institutions did nothing. Skip it; a later run that
    // gets the detail creates it.
    if (r.foreignNet === null && r.trustNet === null && r.dealerNet === null) continue;

    const date = utcDay(r.date);
    const data = {
      date,
      scope: "market",
      industryId: null,
      stockId: null,
      foreignNet: r.foreignNet ?? 0,
      trustNet: r.trustNet ?? 0,
      dealerNet: r.dealerNet ?? 0,
      marginChange: r.marginChange ?? 0,
      turnover: 0,
      volumeChangePct: 0,
      dataSourceId,
      isMock,
    };
    const existing = await db.institutionalFlow.findMany({
      where: { scope: "market", date },
      select: { id: true },
    });
    await writeFlowRow(
      existing.map((row) => row.id),
      data,
      `market ${isoDay(date)}`,
    );
    written++;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------------------

/**
 * What the database already holds, so a re-run of the backfill can skip it.
 *
 * This is not an optimization — it is what makes the backfill usable at all.
 * The historical TWSE reports throttle a client that iterates them, so a full
 * backfill will normally be interrupted part-way and finished by a later run.
 * Without coverage checks each attempt would restart from scratch, re-spend
 * the request budget on data already stored, and get blocked before reaching
 * new ground.
 *
 * Which (stock, month) pairs already hold prices, optionally counting only
 * those written by one source.
 *
 * The `sourceKey` filter is what makes a two-source strategy work. History can
 * be seeded in bulk from an aggregator and then progressively replaced by the
 * official exchange feed as its quota allows — but only if the official run
 * measures its own coverage. Counting any row as done would make the official
 * catch-up a no-op forever, permanently freezing the aggregator's data in
 * place while appearing to have completed.
 */
export async function loadPriceCoverage(sourceKey?: string): Promise<Map<string, Set<string>>> {
  const rows = await db.marketData.findMany({
    where: sourceKey ? { dataSource: { key: sourceKey } } : undefined,
    select: { stockId: true, date: true },
  });
  const coverage = new Map<string, Set<string>>();
  for (const row of rows) {
    const months = coverage.get(row.stockId) ?? new Set<string>();
    months.add(row.date.toISOString().slice(0, 7));
    coverage.set(row.stockId, months);
  }
  return coverage;
}

/** Sessions that already have per-stock institutional flow rows stored,
 *  optionally counting only those from one source. */
export async function loadFlowCoverage(sourceKey?: string): Promise<Set<string>> {
  const rows = await db.institutionalFlow.findMany({
    where: { scope: "stock", ...(sourceKey ? { dataSource: { key: sourceKey } } : {}) },
    select: { date: true },
    distinct: ["date"],
  });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

/** Sessions whose MarketStatus row already carries fetched detail. Breadth is
 *  the probe: it is written only when the per-session reports succeeded. */
export async function loadStatusDetailCoverage(): Promise<Set<string>> {
  const rows = await db.marketStatus.findMany({
    where: { OR: [{ breadthAdvancers: { gt: 0 } }, { breadthDecliners: { gt: 0 } }] },
    select: { date: true },
  });
  return new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Writes OHLCV rows. The derived technical fields (trend, relative strength,
 * valuation position) are deliberately left at their defaults here and filled
 * in by the technicals pass, which needs the whole series in place first.
 */
export async function writeMarketData(
  quotes: MarketQuote[],
  stocks: TrackedStock[],
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  const idByTicker = new Map(stocks.map((s) => [s.ticker, s.id] as const));
  let written = 0;

  // Grouped and ordered per stock so the prior close comes from the batch
  // itself. The exchanges report a point change but no percentage, and a
  // missing change field (which happens on a session a stock did not trade,
  // and on the first session after a suspension) would otherwise be read as
  // "unchanged" — a flat day fabricated out of absent data.
  const byTicker = new Map<string, MarketQuote[]>();
  for (const q of quotes) {
    const bucket = byTicker.get(q.ticker) ?? [];
    bucket.push(q);
    byTicker.set(q.ticker, bucket);
  }

  for (const [ticker, series] of byTicker) {
    const stockId = idByTicker.get(ticker);
    if (!stockId) continue;
    series.sort((a, b) => a.date.getTime() - b.date.getTime());

    // The oldest quote in the batch has no in-batch predecessor, so its prior
    // close has to come from whatever is already stored.
    const earliest = utcDay(series[0].date);
    const storedPrior = await db.marketData.findFirst({
      where: { stockId, date: { lt: earliest } },
      orderBy: { date: "desc" },
      select: { close: true },
    });

    let priorClose: number | null = storedPrior?.close ?? null;

    for (const q of series) {
      const date = utcDay(q.date);
      // Prefer the exchange's own reported change; it is correct across
      // ex-dividend adjustments, where a raw close-to-close difference is not.
      const change = q.change ?? (priorClose !== null ? q.close - priorClose : 0);
      const base = q.change != null ? q.close - q.change : priorClose;
      const changePct = base && base > 0 ? (change / base) * 100 : 0;

      const data = {
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
        change: round2(change),
        changePct: round2(changePct),
        dataSourceId,
        isMock,
      };

      await db.marketData.upsert({
        where: { stockId_date: { stockId, date } },
        create: { stockId, date, ...data },
        update: data,
      });
      written++;
      priorClose = q.close;
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export async function writeFundamentals(
  results: FundamentalResult[],
  stocks: TrackedStock[],
  isMock: boolean,
): Promise<number> {
  const idByTicker = new Map(stocks.map((s) => [s.ticker, s.id] as const));
  let written = 0;

  for (const r of results) {
    const stockId = idByTicker.get(r.ticker);
    if (!stockId) continue;
    const data = {
      value: r.value,
      yoyChangePct: r.yoyChangePct ?? null,
      momChangePct: r.momChangePct ?? null,
      eps: r.eps ?? null,
      isMock,
    };
    await db.stockFundamental.upsert({
      where: { stockId_period_periodType: { stockId, period: r.period, periodType: r.periodType } },
      create: { stockId, period: r.period, periodType: r.periodType, ...data },
      update: data,
    });
    written++;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Catalysts
// ---------------------------------------------------------------------------

export async function writeCatalysts(
  results: NewsCatalystResult[],
  stocks: TrackedStock[],
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  const byTicker = new Map(stocks.map((s) => [s.ticker, s] as const));
  let written = 0;
  const unattached: string[] = [];

  for (const r of results) {
    const stock = r.ticker ? byTicker.get(r.ticker) : undefined;
    if (!stock && !r.industryKey) {
      // Nothing to hang it off: an item for a ticker outside the taxonomy and
      // with no industry of its own would be a catalyst no page can reach.
      unattached.push(r.ticker ?? r.title.slice(0, 24));
      continue;
    }
    const date = utcDay(r.date);

    // Catalysts have no natural unique key, and the same filing reappears in
    // the feed for several days, so identity is (stock, date, title). The
    // database cannot enforce it — an industry-only catalyst stores a NULL
    // stockId, which Postgres compares as distinct, so a unique index would
    // never fire for exactly those rows — which makes this a best-effort
    // dedupe: two overlapping runs can both miss here and store the same news
    // item twice. That costs a duplicated headline, not a corrupted series,
    // which is why it is accepted rather than serialized.
    const existing = await db.catalyst.findFirst({
      where: { stockId: stock?.id ?? null, date, title: r.title },
    });
    if (existing) continue;

    await db.catalyst.create({
      data: {
        stockId: stock?.id ?? null,
        industryId: stock?.industryId ?? null,
        title: r.title,
        description: r.description ?? null,
        date,
        importance: r.importance,
        source: r.source ?? null,
        sourceUrl: r.sourceUrl ?? null,
        dataSourceId,
        isMock,
      },
    });
    written++;
  }

  if (unattached.length) {
    console.warn(
      `[persist] catalysts: dropped ${unattached.length} of ${results.length} items with neither a tracked ticker nor an industry (${sample(unattached)})`,
    );
  }
  return written;
}

// ---------------------------------------------------------------------------
// Institutional flow
// ---------------------------------------------------------------------------

const VOLUME_BASELINE_SESSIONS = 20;

/**
 * Writes stock-scope flows, converting share counts to NT$ thousands.
 *
 * Neither exchange publishes per-stock institutional trading in currency —
 * only in shares — so the value is the session close times the net shares.
 * That is an approximation of the true traded value (institutions do not all
 * transact at the close), but it is the conventional one, and it reconciles
 * to within a few percent of the NT$ market totals the exchange publishes for
 * the same session. Rows whose price is not yet stored are skipped rather
 * than valued at zero.
 *
 * The margin balance is the one field that must NOT go through that
 * valuation, and it is left at zero here. Both exchanges report it per stock
 * in 張 only, and the loan behind those shares was struck at roughly 60% of
 * the price on the day it was taken out and never marks to market — so 張
 * times today's close is a different quantity, measured at 0.4x to 2.6x the
 * exchange's own 融資金額 delta over recent sessions and occasionally with
 * the opposite sign. `marginChange` is an NT$ column, and only the
 * market-scope row can fill it honestly because only the market report
 * publishes a loan amount; a per-stock figure would put two different
 * quantities in one column, formatted by the UI as if they were one. The
 * industry rollup sums stock rows, so it inherits the zero.
 */
export async function writeStockFlows(
  results: InstitutionalFlowResult[],
  stocks: TrackedStock[],
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  if (!results.length) return 0;
  const byTicker = new Map(stocks.map((s) => [s.ticker, s] as const));

  const stockIds = [
    ...new Set(results.map((r) => byTicker.get(r.ticker ?? "")?.id).filter((id): id is string => !!id)),
  ];
  const times = results.map((r) => utcDay(r.date).getTime());
  const earliest = new Date(Math.min(...times));
  const latest = new Date(Math.max(...times));

  // The whole price window is loaded ONCE. Querying per (stock, date) instead
  // costs two round trips per session per stock — ~70 for a single stock over a
  // backfill window, thousands across a fleet — which against a hosted Postgres
  // is the difference between seconds and many minutes, and was slow enough to
  // stop the seed from finishing.
  const priceRows = await db.marketData.findMany({
    where: {
      stockId: { in: stockIds },
      // Reaches back past `earliest` because the volume baseline is a trailing
      // average over sessions before the first row being written.
      date: { gte: utcDayOffset(earliest, VOLUME_BASELINE_SESSIONS * 2), lte: latest },
    },
    select: { stockId: true, date: true, close: true, volume: true },
    orderBy: { date: "asc" },
  });

  const priceByStockDate = new Map<string, { close: number; volume: number }>();
  const seriesByStock = new Map<string, Array<{ time: number; volume: number }>>();
  for (const row of priceRows) {
    const time = utcDay(row.date).getTime();
    priceByStockDate.set(`${row.stockId}|${time}`, { close: row.close, volume: row.volume });
    const series = seriesByStock.get(row.stockId) ?? [];
    series.push({ time, volume: row.volume });
    seriesByStock.set(row.stockId, series);
  }

  const existingRows = await db.institutionalFlow.findMany({
    where: { scope: "stock", stockId: { in: stockIds }, date: { gte: earliest, lte: latest } },
    select: { id: true, stockId: true, date: true },
  });
  // Ids, not one id: the identity is not unique in the database (see
  // writeFlowRow), so every row matching it has to be carried and rewritten.
  const existingByKey = new Map<string, string[]>();
  for (const row of existingRows) {
    const key = `${row.stockId}|${utcDay(row.date).getTime()}`;
    const ids = existingByKey.get(key) ?? [];
    ids.push(row.id);
    existingByKey.set(key, ids);
  }

  let written = 0;
  const untracked: string[] = [];
  const unpriced: string[] = [];
  for (const r of results) {
    const stock = r.ticker ? byTicker.get(r.ticker) : undefined;
    if (!stock) {
      untracked.push(r.ticker ?? "(no ticker)");
      continue;
    }
    const time = utcDay(r.date).getTime();
    const price = priceByStockDate.get(`${stock.id}|${time}`);
    // No stored price means no way to value the net shares. Skipping beats
    // writing a zero that reads as "the institutions did nothing".
    if (!price) {
      unpriced.push(`${r.ticker}@${isoDay(new Date(time))}`);
      continue;
    }

    const toThousands = (shares: number) =>
      r.unit === "shares" ? Math.round((shares * price.close) / 1000) : Math.round(shares);

    const priorAvg = trailingAverageVolume(seriesByStock.get(stock.id) ?? [], time);
    const data = {
      date: new Date(time),
      scope: "stock",
      industryId: stock.industryId,
      stockId: stock.id,
      foreignNet: toThousands(r.foreignNet),
      trustNet: toThousands(r.trustNet),
      dealerNet: toThousands(r.dealerNet),
      // Not valued from r.marginChange — see the note above. The feed reports
      // it in 張 and this column is NT$ thousands of loan principal.
      marginChange: 0,
      turnover: Math.round((price.close * price.volume) / 1000),
      volumeChangePct: priorAvg > 0 ? round1((price.volume / priorAvg - 1) * 100) : 0,
      dataSourceId,
      isMock,
    };

    await writeFlowRow(
      existingByKey.get(`${stock.id}|${time}`) ?? [],
      data,
      `stock ${r.ticker} ${isoDay(new Date(time))}`,
    );
    written++;
  }

  // The return value counts successes only, and every caller logs it as if it
  // were the size of what it handed over. A session whose price leg failed
  // drops EVERY flow row here, which without this warning is indistinguishable
  // in the logs from a session on which no institution traded.
  if (untracked.length) {
    console.warn(
      `[persist] stock flows: dropped ${untracked.length} of ${results.length} rows for tickers outside the taxonomy (${sample(untracked)})`,
    );
  }
  if (unpriced.length) {
    console.warn(
      `[persist] stock flows: dropped ${unpriced.length} of ${results.length} rows with no stored close to value them at (${sample(unpriced)})`,
    );
  }
  return written;
}

/** Mean volume over the sessions strictly before `time`, from a preloaded
 *  ascending series. */
function trailingAverageVolume(series: Array<{ time: number; volume: number }>, time: number): number {
  const prior = series.filter((p) => p.time < time).slice(-VOLUME_BASELINE_SESSIONS);
  if (!prior.length) return 0;
  return prior.reduce((sum, p) => sum + p.volume, 0) / prior.length;
}

/**
 * Rolls stock-scope flows up into one industry-scope row per session.
 *
 * The industry figure is a sum of its members rather than an independent
 * fetch, so drilling from an industry card into its constituents always adds
 * up. breakoutCount is left alone: it is a chart property the technicals pass
 * derives from prices, not something a flow feed reports.
 */
export async function aggregateIndustryFlows(
  date: Date,
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  const day = utcDay(date);
  const stockFlows = await db.institutionalFlow.findMany({
    where: { scope: "stock", date: day },
    select: {
      industryId: true,
      foreignNet: true,
      trustNet: true,
      dealerNet: true,
      turnover: true,
      volumeChangePct: true,
    },
  });
  if (!stockFlows.length) return 0;

  const byIndustry = new Map<string, typeof stockFlows>();
  let unclassified = 0;
  for (const flow of stockFlows) {
    if (!flow.industryId) {
      unclassified++;
      continue;
    }
    const bucket = byIndustry.get(flow.industryId) ?? [];
    bucket.push(flow);
    byIndustry.set(flow.industryId, bucket);
  }
  if (unclassified) {
    console.warn(
      `[persist] industry rollup ${isoDay(day)}: ${unclassified} stock flow rows carry no industry and were left out of every industry total`,
    );
  }

  let written = 0;
  for (const [industryId, rows] of byIndustry) {
    const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
    const turnover = sum((r) => r.turnover);
    // Turnover-weighted, so a small illiquid member cannot swing the group's
    // volume expansion the way an equal-weighted mean would.
    const volumeChangePct =
      turnover > 0
        ? round1(rows.reduce((a, r) => a + r.volumeChangePct * r.turnover, 0) / turnover)
        : round1(rows.reduce((a, r) => a + r.volumeChangePct, 0) / rows.length);

    const data = {
      date: day,
      scope: "industry",
      industryId,
      stockId: null,
      foreignNet: Math.round(sum((r) => r.foreignNet)),
      trustNet: Math.round(sum((r) => r.trustNet)),
      dealerNet: Math.round(sum((r) => r.dealerNet)),
      // Stock scope stores no margin figure (see writeStockFlows), so there is
      // nothing to roll up. Written explicitly rather than left out, so
      // re-aggregating a session clears any value an earlier run derived from
      // the per-stock 張 counts.
      marginChange: 0,
      turnover: Math.round(turnover),
      volumeChangePct,
      dataSourceId,
      isMock,
    };

    const existing = await db.institutionalFlow.findMany({
      where: { scope: "industry", industryId, date: day },
      select: { id: true },
    });
    await writeFlowRow(
      existing.map((row) => row.id),
      data,
      `industry ${industryId} ${isoDay(day)}`,
    );
    written++;
  }

  // How many members each total was actually built from. An industry summed
  // from two of its three stocks is not visibly different from a complete one
  // in the row it writes, so the count is reported here — that is the only
  // place both the taxonomy's size and the rows that survived are known.
  const memberCounts = [...byIndustry.values()].map((rows) => rows.length);
  console.log(
    `[persist] industry rollup ${isoDay(day)}: ${written} industries from ${stockFlows.length - unclassified} stock rows` +
      (memberCounts.length ? ` (smallest ${Math.min(...memberCounts)} members)` : ""),
  );
  return written;
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export async function writeIndicatorValues(
  results: IndicatorResult[],
  dataSourceId: string,
  isMock: boolean,
): Promise<number> {
  let written = 0;

  for (const r of results) {
    const indicator = await db.indicator.findFirst({ where: { key: r.indicatorKey } });
    if (!indicator) continue;
    const date = utcDay(r.date);

    const prev = await db.indicatorValue.findFirst({
      where: { indicatorId: indicator.id, date: { lt: date } },
      orderBy: { date: "desc" },
    });
    const pctChange = prev && prev.value !== 0 ? ((r.value - prev.value) / prev.value) * 100 : null;

    const data = {
      value: r.value,
      previousValue: prev?.value ?? null,
      pctChange: pctChange !== null ? round2(pctChange) : null,
      sourceUrl: r.sourceUrl ?? null,
      dataSourceId,
      dataTimestamp: r.date,
      isMock,
    };

    await db.indicatorValue.upsert({
      where: { indicatorId_date: { indicatorId: indicator.id, date } },
      create: { indicatorId: indicator.id, date, ...data },
      update: data,
    });
    written++;
  }
  return written;
}

// ---------------------------------------------------------------------------

/**
 * Applies one flow row to whatever already occupies its identity.
 *
 * `institutional_flows` has no unique index the database can enforce: each of
 * the three identities — (date) at market scope, (stockId, date) at stock
 * scope, (industryId, date) at industry scope — leaves one member NULL, and
 * Postgres compares NULLs as distinct, so a plain composite unique would
 * never fire for exactly the rows that need it. Identity is therefore a
 * convention these writers maintain, which has two consequences worth being
 * explicit about.
 *
 * First, two overlapping runs can both miss on the read and both insert. That
 * is why the update path takes EVERY matching row rather than the first one:
 * rewriting one of a pair leaves the other frozen at an older run's numbers,
 * which is what turns a harmless duplicate into two rows disagreeing about the
 * same session — and a duplicate also silently halves the flow-history window
 * the industry radar reads, so it is warned about rather than absorbed.
 *
 * Second, the race itself cannot be closed here; it needs the partial unique
 * indexes the schema still lacks.
 */
async function writeFlowRow(
  existingIds: string[],
  data: Prisma.InstitutionalFlowUncheckedCreateInput,
  identity: string,
): Promise<void> {
  if (!existingIds.length) {
    await db.institutionalFlow.create({ data });
    return;
  }
  if (existingIds.length > 1) {
    console.warn(
      `[persist] ${existingIds.length} flow rows share the identity ${identity} — rewriting all of them`,
    );
  }
  for (const id of existingIds) {
    await db.institutionalFlow.update({ where: { id }, data });
  }
}

/** The session a UTC-midnight date stands for, for log lines. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Enough of a drop list to identify the pattern, without flooding the log
 *  when a whole session was dropped. */
function sample(items: string[], limit = 8): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")}, +${items.length - limit} more`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
