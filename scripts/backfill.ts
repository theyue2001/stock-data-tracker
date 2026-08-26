/**
 * Backfills real history from the exchange feeds, then recomputes every
 * derived row from it.
 *
 * A live daily job alone is not enough to make this app work: relative
 * strength looks back 60 sessions, the volume-expansion reading needs a
 * 20-session baseline, revenue is compared year-over-year, and the sentiment
 * ranking needs five prior sessions before "#9 -> #1" means anything. Without
 * history, every one of those silently computes against a one-row window.
 *
 * ## This script expects to be interrupted
 *
 * The only source of per-session Taiwan history is the interactive TWSE site,
 * and it enforces a rolling request quota per client across the WHOLE HOST —
 * not per report path. Exceeding it returns a 307 "for security reasons"
 * page for every endpoint on www.twse.com.tw, including ones barely touched,
 * and clears on its own within minutes. There is no paid tier, no key, and no
 * bulk endpoint to ask for instead; `openapi.twse.com.tw` is sanctioned but
 * only ever serves the current month.
 *
 * So this is built as a RESUMABLE COLLECTOR, not a one-shot job:
 *
 *  - a per-run request budget keeps each run under the quota by design
 *  - every leg checks what is already stored and skips it
 *  - every leg writes as it goes, so an interruption keeps its progress
 *  - a spent budget or a block ends one leg, never the run — the next leg may
 *    target a different, unthrottled host
 *
 * Run it repeatedly until `[backfill] remaining` reaches zero. Each run makes
 * progress; none of them redoes work. Spacing runs out over an hour or more is
 * more effective than raising --max-requests, since the quota refills on time.
 *
 * ## Flow history covers every session that gets scored
 *
 * The flow window is not a short recent slice: it defaults to the whole window
 * `recompute` will score. A scored session with no institutional-flow row of
 * its own has its capital-flow and institutional-flow components marked as
 * having no data and dropped from the weighting, so a narrower flow window
 * leaves a stretch of scores computed from a reduced definition — flagged
 * 參考性低 in the UI rather than silently fake-neutral, but still a stretch that
 * ends in a step where coverage begins, and the week-over-week status
 * comparison reads that step as a market-wide regime change. Seeding the wider
 * window is free
 * (FinMind returns any date range in one pass per stock); the official
 * catch-up just has more sessions to work through, which costs more runs
 * rather than longer ones. `--flow-sessions=N` pins it back to a recent slice.
 *
 *   npm run db:backfill                          # resume with defaults
 *   npm run db:backfill -- --months=12
 *   npm run db:backfill -- --max-requests=200    # riskier: may trip the quota
 *   npm run db:backfill -- --flow-sessions=40    # cheaper, at the cost of the above
 *   npm run db:backfill -- --status-detail=0     # skip breadth/market-flow history
 *   npm run db:backfill -- --only=prices         # one leg at a time
 */
import { db } from "../src/lib/db";
import { utcDay } from "../src/lib/dates";
import { BlockedError, BudgetExhaustedError, requestsMade, setRequestBudget } from "../src/lib/providers/live/http";
import {
  aggregateIndustryFlows,
  ensureDataSource,
  loadFlowCoverage,
  loadPriceCoverage,
  loadStatusDetailCoverage,
  loadTrackedStocks,
  writeFundamentals,
  writeIndicatorValues,
  writeMarketData,
  writeMarketScopeFlows,
  writeMarketStatus,
  writeStockFlows,
  type TrackedStock,
} from "../src/lib/jobs/persist";
import { recomputeTechnicals } from "../src/lib/jobs/refresh-data";
import { persistIndustryScoresForDate } from "../src/lib/jobs/compute-scores";
import { persistIndustrySentimentForDate } from "../src/lib/jobs/compute-sentiment";
import { resolveExchanges, TwseMarketDataProvider } from "../src/lib/providers/live/market-data-provider";
import {
  toResult,
  TwseMarketStatusProvider,
  type SessionCore,
} from "../src/lib/providers/live/market-status-provider";
import { TwseInstitutionalFlowProvider } from "../src/lib/providers/live/flow-provider";
import { FinMindHistoryProvider } from "../src/lib/providers/live/finmind-provider";
import { MopsFundamentalProvider } from "../src/lib/providers/live/fundamental-provider";
import {
  DerivedOdmRevenueProvider,
  SecHyperscalerCapexProvider,
} from "../src/lib/providers/live/indicator-provider";
import { revalidateDeployedCache } from "./_revalidate";

type Leg =
  | "sessions"
  | "seed-prices"
  | "seed-flows"
  | "prices"
  | "fundamentals"
  | "flows"
  | "status-detail"
  | "indicators"
  | "recompute";

/**
 * Default order matters. The two `seed-*` legs pull history in bulk from
 * FinMind first, so the app has a usable dataset within minutes; the official
 * `prices` / `flows` legs then overwrite it in place as the TWSE quota allows.
 * Both write to the same rows, and coverage is measured per source, so running
 * the official legs repeatedly converges on fully official data without ever
 * refetching what that source already has.
 */
const ALL_LEGS: Leg[] = [
  "sessions",
  "seed-prices",
  "seed-flows",
  "prices",
  "fundamentals",
  "flows",
  "status-detail",
  "indicators",
  "recompute",
];

/** Coverage key for the official price feed, so the catch-up run measures its
 *  own progress rather than counting seeded rows as done. */
const TWSE_PRICE_SOURCE = "twse-tpex-prices";
const TWSE_FLOW_SOURCE = "twse-tpex-institutional";

/**
 * Priced sessions at the start of the window that are deliberately NOT scored.
 * The technical derivation needs 8 sessions behind it and relative strength
 * wants 60, so those rows would be made mostly of neutral fallbacks — which
 * the week-over-week status comparison would then read as a real regime.
 */
const WARMUP_SESSIONS = 30;

/**
 * Floor for the flow window on a database too small to score anything yet.
 * Below the warm-up there are no scores to protect, but the sentiment ranking
 * still reads the most recent handful of sessions and the flow tables a few
 * weeks, so the window never shrinks below what those need.
 */
const MIN_FLOW_SESSIONS = 40;

interface Options {
  months: number;
  /** Left undefined by default and resolved in `main` once the trading
   *  calendar is known, because the window that must be covered is "everything
   *  `recompute` will score" — a count nothing knows at parse time. An
   *  explicit `--flow-sessions` still wins. */
  flowSessions: number | undefined;
  statusDetailSessions: number;
  revenueMonths: number;
  maxRequests: number;
  legs: Leg[];
}

/** The rate-limited host. Everything else is generous by comparison. */
const TWSE_HOST = "www.twse.com.tw";

function parseArgs(argv: string[]): Options {
  const num = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split("=")[1]) : undefined;
  };
  const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  return {
    months: num("months") ?? 8,
    flowSessions: num("flow-sessions"),
    // Detail keeps a short recent window of its own. Unlike per-stock flow,
    // nothing in the UI or the scoring passes reads historical breadth or
    // market-level flow outside it, so paying three throttled requests per
    // session for more of it is what gets the client blocked before the
    // prices — which everything does read — are covered.
    statusDetailSessions: num("status-detail") ?? 40,
    revenueMonths: num("revenue-months") ?? 14,
    // Observed safe well under 150; blocks appeared somewhere past that even
    // at 2-4 s spacing. Staying under a known-good ceiling and resuming later
    // beats racing to the limit and being cut off at an arbitrary point.
    maxRequests: num("max-requests") ?? 140,
    legs: only ? (only.split(",") as Leg[]) : ALL_LEGS,
  };
}

/**
 * Runs one leg. A spent budget or a block ends that leg only — never the run —
 * because each leg writes as it goes and the next leg may target a different,
 * unthrottled host.
 */
async function leg(name: string, run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      console.warn(`[backfill] ${name}: request budget spent — stopping this leg cleanly`);
      return false;
    }
    if (error instanceof BlockedError) {
      console.warn(`[backfill] ${name}: BLOCKED — ${error.message}`);
      return false;
    }
    console.error(`[backfill] ${name}: ${(error as Error).message}`);
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const now = new Date();
  const from = utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - opts.months, 1)));
  const to = utcDay(now);
  const blocked: string[] = [];

  setRequestBudget(TWSE_HOST, opts.maxRequests);
  console.log(
    `[backfill] window ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}; ` +
      `legs: ${opts.legs.join(", ")}; budget: ${opts.maxRequests} requests to ${TWSE_HOST}`,
  );

  const stocks = await resolveTradedStocks();

  // --- TAIEX sessions (cheap: one request per calendar month) ---------------
  const statusProvider = new TwseMarketStatusProvider();
  const statusSourceId = await ensureDataSource(statusProvider.source);
  let sessions: SessionCore[] = [];

  if (opts.legs.includes("sessions")) {
    const ok = await leg("sessions", async () => {
      sessions = await statusProvider.fetchSessions(from, to);
      await writeMarketStatus(sessions.map((s) => toResult(s)), false);
      console.log(`[backfill] sessions: ${sessions.length} TAIEX rows`);
    });
    if (!ok) blocked.push("sessions");
  }
  if (!sessions.length) {
    // Either the leg was skipped or it was blocked. Stored TAIEX rows are just
    // as good a calendar for the legs that iterate per session.
    const stored = await db.marketStatus.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true, close: true, change: true, volume: true },
      orderBy: { date: "asc" },
    });
    sessions = stored.map((r) => ({ date: r.date, close: r.close, change: r.change, volume: r.volume }));
    console.log(`[backfill] sessions: using ${sessions.length} already stored`);
  }
  // Any date we hold a price for is, by definition, a trading session. The flow
  // leg needs nothing but dates, so it can run off this even when the TAIEX leg
  // is blocked — otherwise it sits idle for a whole run with a perfectly good
  // calendar available.
  //
  // Deliberately NOT merged into `sessions`: those rows carry the index level
  // that the status-detail leg writes back to MarketStatus, and a date-only
  // entry would write a TAIEX close of zero over a real one.
  const flowCalendar = sessions.length ? sessions.map((s) => s.date) : await pricedSessionDates(from, to);
  if (!sessions.length) {
    console.log(`[backfill] flow calendar: ${flowCalendar.length} dates derived from stored prices`);
  }

  // Every session `recompute` scores needs a flow row of its own, so the window
  // defaults to the scored one — the whole calendar less the warm-up — rather
  // than to a short recent slice. Without that, the sessions ahead of the flow
  // rows lose their two flow components from the weighting and the first
  // covered session reads as a market-wide regime change; see recomputeDerived,
  // which warns when coverage still falls short.
  //
  // Both flow legs work from this one list of dates, newest first, so the bulk
  // seed and the official catch-up can never disagree about which sessions the
  // window contains.
  const flowTarget = opts.flowSessions ?? Math.max(MIN_FLOW_SESSIONS, flowCalendar.length - WARMUP_SESSIONS);
  const flowWindow = [...flowCalendar].sort((a, b) => b.getTime() - a.getTime()).slice(0, flowTarget);
  if (flowWindow.length) {
    console.log(
      `[backfill] flow window: ${flowWindow.length} sessions, ` +
        `${flowWindow[flowWindow.length - 1].toISOString().slice(0, 10)} -> ` +
        `${flowWindow[0].toISOString().slice(0, 10)}`,
    );
  }

  // --- Bulk history seed (FinMind: one request per stock) -------------------
  if (opts.legs.includes("seed-prices")) {
    await leg("seed-prices", () => seedPrices(stocks, from, to));
  }
  if (opts.legs.includes("seed-flows")) {
    await leg("seed-flows", () => seedFlows(stocks, flowWindow));
  }

  // --- Prices, official feed (resumable per stock-month) --------------------
  if (opts.legs.includes("prices")) {
    const ok = await leg("prices", () => backfillPrices(stocks, from, to));
    if (!ok) blocked.push("prices");
  }

  // --- Monthly revenue / EPS ------------------------------------------------
  if (opts.legs.includes("fundamentals")) {
    const ok = await leg("fundamentals", async () => {
      const provider = new MopsFundamentalProvider();
      await ensureDataSource(provider.source);
      const history = await provider.fetchHistory!(stocks, opts.revenueMonths, to);
      const latest = await provider.fetchLatest(stocks);
      const written = await writeFundamentals([...history, ...latest], stocks, false);
      console.log(`[backfill] fundamentals: ${written} rows`);
    });
    if (!ok) blocked.push("fundamentals");
  }

  // --- Per-stock institutional flow (resumable per session) -----------------
  if (opts.legs.includes("flows") && flowWindow.length) {
    const ok = await leg("flows", () => backfillFlows(stocks, flowWindow));
    if (!ok) blocked.push("flows");
  }

  // --- Per-session market detail (resumable per session) --------------------
  if (opts.legs.includes("status-detail") && opts.statusDetailSessions > 0) {
    const ok = await leg("status-detail", () =>
      backfillStatusDetail(statusProvider, statusSourceId, sessions, opts.statusDetailSessions),
    );
    if (!ok) blocked.push("status-detail");
  }

  // --- Leading indicators (natively historical, one pull each) -------------
  if (opts.legs.includes("indicators")) {
    await leg("indicators", async () => {
      for (const provider of [new SecHyperscalerCapexProvider(), new DerivedOdmRevenueProvider()]) {
        const sourceId = await ensureDataSource(provider.source);
        const written = await writeIndicatorValues(await provider.fetchLatest(), sourceId, false);
        console.log(`[backfill] ${provider.source.key}: ${written} values`);
      }
    });
  }

  // --- Recompute everything derived, oldest session first ------------------
  if (opts.legs.includes("recompute")) {
    await leg("recompute", () => recomputeDerived(sessions));
  }

  console.log(`[backfill] spent ${requestsMade(TWSE_HOST)}/${opts.maxRequests} requests to ${TWSE_HOST}`);
  await report(from, to, opts, flowTarget, blocked);

  // This script rewrites the widest slice of exactly what the cached page reads
  // serve, so it is the LAST place that should be left out of the invalidation
  // the daily jobs already do. Without this, a backfill lands in the database
  // and the deployed site keeps serving the pre-backfill dataset for up to a
  // day. Never throws, and no-ops when APP_URL is unset — see _revalidate.ts.
  await revalidateDeployedCache("backfill");
}

/** Drops tickers that are not listed on either board — merged or delisted. */
async function resolveTradedStocks(): Promise<TrackedStock[]> {
  const all = await loadTrackedStocks();
  const resolved = await resolveExchanges(all.map((s) => s.ticker));
  const missing: string[] = [];
  let corrected = 0;

  for (const stock of all) {
    const exchange = resolved.get(stock.ticker) ?? null;
    if (!exchange) {
      missing.push(stock.ticker);
      continue;
    }
    if (exchange !== stock.exchange) {
      await db.stock.update({ where: { id: stock.id }, data: { exchange } });
      corrected++;
    }
  }

  console.log(`[backfill] exchanges: ${corrected} corrected, ${missing.length} not traded`);
  if (missing.length) {
    console.warn(`[backfill] NOT TRADING — no data will ever exist for: ${missing.join(", ")}`);
  }
  return (await loadTrackedStocks()).filter((s) => !missing.includes(s.ticker));
}

async function backfillPrices(stocks: TrackedStock[], from: Date, to: Date): Promise<void> {
  const provider = new TwseMarketDataProvider();
  const sourceId = await ensureDataSource(provider.source);
  // Scoped to this source: seeded rows must not count as covered, or the
  // official catch-up would silently never run.
  const coverage = await loadPriceCoverage(TWSE_PRICE_SOURCE);
  const months = monthStarts(from, to);

  // The current month is always re-fetched: it is still accumulating sessions,
  // so "already covered" would freeze it at whatever day the first run saw.
  const currentMonth = to.toISOString().slice(0, 7);

  const pending = stocks.flatMap((stock) =>
    months
      .map((month) => ({ stock, month, key: month.toISOString().slice(0, 7) }))
      .filter(({ key }) => key === currentMonth || !coverage.get(stock.id)?.has(key)),
  );

  console.log(`[backfill] prices: ${pending.length} stock-months to fetch`);
  let done = 0;
  let rows = 0;

  for (const { stock, month } of pending) {
    // Written per stock-month so a block leaves everything before it stored.
    const quotes = await provider.fetchStockMonth(stock, month);
    rows += await writeMarketData(quotes, stocks, sourceId, false);
    done++;
    if (done % 20 === 0 || done === pending.length) {
      console.log(`[backfill] prices: ${done}/${pending.length} stock-months, ${rows} rows`);
    }
  }
}

async function backfillFlows(stocks: TrackedStock[], window: Date[]): Promise<void> {
  const provider = new TwseInstitutionalFlowProvider();
  const sourceId = await ensureDataSource(provider.source);
  const covered = await loadFlowCoverage(TWSE_FLOW_SOURCE);

  // The window arrives newest first and that order is kept: the sentiment
  // module reads the most recent handful, so the sessions fetched before a
  // block should be the ones that matter most. Over a window this wide a block
  // is expected rather than exceptional — it takes several runs to walk.
  const pending = window.filter((d) => !covered.has(d.toISOString().slice(0, 10)));

  console.log(`[backfill] flows: ${pending.length} sessions to fetch`);
  let done = 0;
  let rows = 0;

  for (const date of pending) {
    const results = await provider.fetchForDate(stocks, date);
    rows += await writeStockFlows(results, stocks, sourceId, false);
    await aggregateIndustryFlows(date, sourceId, false);
    done++;
    if (done % 10 === 0 || done === pending.length) {
      console.log(`[backfill] flows: ${done}/${pending.length} sessions, ${rows} rows`);
    }
  }
}

/**
 * Seeds price history in bulk. One request per stock covers the whole window,
 * against a host with no per-session quota — which is the entire reason this
 * leg exists alongside the official one.
 */
async function seedPrices(stocks: TrackedStock[], from: Date, to: Date): Promise<void> {
  const provider = new FinMindHistoryProvider();
  const sourceId = await ensureDataSource(provider.source);
  const coverage = await loadPriceCoverage();

  const months = monthStarts(from, to).map((m) => m.toISOString().slice(0, 7));
  const pending = stocks.filter((s) => {
    const have = coverage.get(s.id);
    return !have || months.some((m) => !have.has(m));
  });

  console.log(`[backfill] seed-prices: ${pending.length} stocks to fetch`);
  let done = 0;
  let rows = 0;

  for (const stock of pending) {
    try {
      const quotes = await provider.fetchPrices(stock, from, to);
      rows += await writeMarketData(quotes, stocks, sourceId, false);
    } catch (error) {
      // A per-stock failure (quota, or a ticker the aggregator lacks) must not
      // end the leg — the official catch-up covers whatever is missed.
      console.warn(`[backfill] seed-prices ${stock.ticker}: ${(error as Error).message}`);
    }
    done++;
    if (done % 10 === 0 || done === pending.length) {
      console.log(`[backfill] seed-prices: ${done}/${pending.length} stocks, ${rows} rows`);
    }
  }
}

/**
 * Seeds per-stock institutional flow and margin history in bulk, over exactly
 * the flow window the official leg will later overwrite.
 *
 * The window's width costs nothing here: one pass per stock returns whatever
 * date range it is given, so seeding every scored session is the same two
 * requests per stock as seeding a few recent weeks would be. This is what makes
 * full coverage of the scored window affordable at all.
 */
async function seedFlows(stocks: TrackedStock[], window: Date[]): Promise<void> {
  if (!window.length) return;
  const provider = new FinMindHistoryProvider();
  const sourceId = await ensureDataSource(provider.flowSource);

  // The window is newest first, so its ends are the range to request.
  const start = window[window.length - 1];
  const end = window[0];

  console.log(`[backfill] seed-flows: ${stocks.length} stocks from ${start.toISOString().slice(0, 10)}`);
  let done = 0;
  let rows = 0;
  const touched = new Set<number>();

  for (const stock of stocks) {
    try {
      const flows = await provider.fetchFlows(stock, start, end);
      rows += await writeStockFlows(flows, stocks, sourceId, false);
      for (const f of flows) touched.add(utcDay(f.date).getTime());
    } catch (error) {
      console.warn(`[backfill] seed-flows ${stock.ticker}: ${(error as Error).message}`);
    }
    done++;
    if (done % 10 === 0 || done === stocks.length) {
      console.log(`[backfill] seed-flows: ${done}/${stocks.length} stocks, ${rows} rows`);
    }
  }

  // Industry rollups only once, after every member stock is stored — otherwise
  // each stock would rewrite the aggregate from a partial member set.
  for (const time of touched) {
    await aggregateIndustryFlows(new Date(time), sourceId, false);
  }
  console.log(`[backfill] seed-flows: aggregated ${touched.size} sessions to industry scope`);
}

/** Dates for which any price is stored — a trading calendar we already own. */
async function pricedSessionDates(from: Date, to: Date): Promise<Date[]> {
  const rows = await db.marketData.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.date);
}

async function backfillStatusDetail(
  provider: TwseMarketStatusProvider,
  sourceId: string,
  sessions: SessionCore[],
  limit: number,
): Promise<void> {
  const covered = await loadStatusDetailCoverage();
  const pending = [...sessions]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit)
    .filter((s) => !covered.has(s.date.toISOString().slice(0, 10)));

  console.log(`[backfill] status-detail: ${pending.length} sessions to fetch`);
  let done = 0;

  for (const session of pending) {
    const result = toResult(session, await provider.fetchSessionDetail(session.date));
    await writeMarketStatus([result], false);
    await writeMarketScopeFlows([result], sourceId, false);
    done++;
    if (done % 10 === 0 || done === pending.length) {
      console.log(`[backfill] status-detail: ${done}/${pending.length} sessions`);
    }
  }
}

/**
 * Recomputes technicals, scores and sentiment from whatever is now stored.
 *
 * Oldest session first, because both scoring passes resolve their status
 * against earlier rows: computing newest-first would compare every session
 * against history that does not exist yet.
 */
async function recomputeDerived(sessions: SessionCore[]): Promise<void> {
  const priced = await db.marketData.findMany({
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "asc" },
  });
  const pricedDays = new Set(priced.map((r) => r.date.toISOString().slice(0, 10)));

  // Only sessions that actually have prices can produce technicals, and the
  // earliest of those are dropped by the warm-up: too little history behind
  // them to score against (see WARMUP_SESSIONS).
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const usable = sessions
    .filter((s) => pricedDays.has(day(s.date)))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const scored = usable.slice(WARMUP_SESSIONS);

  if (!scored.length) {
    console.warn(
      `[backfill] recompute: only ${usable.length} priced sessions stored, need more than ${WARMUP_SESSIONS} — skipped`,
    );
    return;
  }

  // Flow coverage is read from storage, not from this run's flow legs: the
  // collector is resumable, so most covered sessions were fetched by an earlier
  // run. Industry scope is the one the scoring passes actually read, and it
  // exists only where aggregateIndustryFlows found member-stock rows to roll
  // up — so this measures what the scores will really be computed from.
  const flowRows = await db.institutionalFlow.findMany({
    where: { scope: "industry" },
    select: { date: true },
    distinct: ["date"],
  });
  const flowDays = new Set(flowRows.map((r) => day(r.date)));
  const uncovered = scored.filter((s) => !flowDays.has(day(s.date)));

  // Said before the pass rather than after, because the pass is slow and this
  // is the one thing an operator must know before trusting its row count: a
  // scored session with no flow row is not a slightly worse row, it is a row
  // scored from a reduced definition with both flow components missing.
  if (uncovered.length) {
    console.warn(
      `[backfill] recompute: WARNING — ${uncovered.length} of ${scored.length} sessions to score ` +
        `(${day(uncovered[0].date)}..${day(uncovered[uncovered.length - 1].date)}) have no institutional flow ` +
        `stored, so their capital-flow and institutional-flow components are marked as having no data and ` +
        `dropped from the weighting (surfaced as 無資料, and 參考性低 on the total), then step to real values ` +
        `where coverage begins. Re-run until the flow legs finish, then \`--only=recompute\` to overwrite them.`,
    );
  }

  await recomputeTechnicals(usable[usable.length - 1].date);

  let scores = 0;
  let sentiment = 0;
  for (const session of scored) {
    scores += await persistIndustryScoresForDate(session.date);
    sentiment += await persistIndustrySentimentForDate(session.date);
  }
  // The window and the flow coverage belong in this line, not just the totals:
  // "2058 score rows" on its own reads as 2058 good rows.
  console.log(
    `[backfill] recompute: ${scores} score rows, ${sentiment} sentiment snapshots over ` +
      `${day(scored[0].date)}..${day(scored[scored.length - 1].date)}; ` +
      `${scored.length - uncovered.length}/${scored.length} of those sessions have real institutional flow ` +
      `behind them`,
  );
}

/** What is stored, what is still missing, and whether another run is needed. */
async function report(
  from: Date,
  to: Date,
  opts: Options,
  flowTarget: number,
  blocked: string[],
): Promise<void> {
  const stocks = await loadTrackedStocks();
  const months = monthStarts(from, to).length;
  const coverage = await loadPriceCoverage();
  const storedStockMonths = [...coverage.values()].reduce((sum, months) => sum + months.size, 0);

  const [statusRows, detailRows, flowSessions, priceRows, fundamentals, indicatorValues] = await Promise.all([
    db.marketStatus.count(),
    loadStatusDetailCoverage().then((s) => s.size),
    loadFlowCoverage().then((s) => s.size),
    db.marketData.count(),
    db.stockFundamental.count(),
    db.indicatorValue.count(),
  ]);

  console.log("\n[backfill] stored:", {
    taiexSessions: statusRows,
    taiexSessionsWithDetail: `${detailRows}/${opts.statusDetailSessions}`,
    priceRows,
    stockMonths: `${storedStockMonths}/${stocks.length * months}`,
    flowSessions: `${flowSessions}/${flowTarget}`,
    fundamentals,
    indicatorValues,
  });

  const remaining =
    Math.max(0, stocks.length * months - storedStockMonths) +
    Math.max(0, flowTarget - flowSessions) +
    Math.max(0, opts.statusDetailSessions - detailRows);

  if (blocked.length) {
    console.warn(
      `\n[backfill] BLOCKED legs: ${blocked.join(", ")}. TWSE rate-limits per report path; ` +
        `wait for the block to lapse (typically tens of minutes) and re-run — nothing already stored is refetched.`,
    );
  }
  console.log(`[backfill] remaining units of work: ~${remaining}${remaining ? " — re-run to continue" : " — complete"}`);
}

function monthStarts(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
