import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { sessionString } from "@/lib/market-session";
import type { DataSources, IntradayRow, LiveSources } from "@/lib/live/snapshot";

/**
 * Jobs whose runs never write anything a page renders from the after-hours
 * tables: the intraday tick has its own version component and is updated in
 * place, and `verify` only probes source shapes. Counting them would make
 * every open tab re-fetch its page once a minute for nothing.
 */
const NON_DATA_JOBS = ["intraday", "verify"];

/**
 * Four indexed lookups (MarketStatus.date is unique, IntradayIndex is unique
 * on (index, date)); the MarketData max is a scan of a table that holds one
 * row per tracked stock per session, small enough not to need its own index.
 */
export async function readDataSources(): Promise<DataSources> {
  const [market, prices, lastRun] = await Promise.all([
    db.marketStatus.findFirst({ orderBy: { date: "desc" }, select: { date: true, isMock: true, createdAt: true } }),
    db.marketData.aggregate({ _max: { date: true } }),
    db.jobRun.findFirst({
      where: { finishedAt: { not: null }, status: { in: ["success", "partial"] }, job: { notIn: NON_DATA_JOBS } },
      orderBy: { finishedAt: "desc" },
      select: { id: true, finishedAt: true },
    }),
  ]);

  return {
    market: market ? { session: sessionString(market.date), isMock: market.isMock, createdAt: market.createdAt.toISOString() } : null,
    pricesSession: prices._max.date ? sessionString(prices._max.date) : null,
    lastRun: lastRun?.finishedAt ? { id: lastRun.id, finishedAt: lastRun.finishedAt.toISOString() } : null,
  };
}

/** The newest TAIEX intraday row, whatever its date — the label rules decide what it means. */
export async function readIntradayRow(): Promise<IntradayRow | null> {
  const row = await db.intradayIndex.findFirst({ where: { index: "TAIEX" }, orderBy: { date: "desc" } });
  if (!row) return null;
  return {
    date: sessionString(row.date),
    last: row.last,
    change: row.change,
    changePct: row.changePct,
    high: row.high,
    low: row.low,
    tickAt: row.tickAt,
    updatedAt: row.updatedAt.toISOString(),
    isMock: row.isMock,
  };
}

/**
 * One shared read behind GET /api/live, so N open tabs polling every 15 s
 * cost the database a handful of queries every few seconds, not N.
 *
 * Inline profile rather than the `seconds` preset: that preset revalidates
 * after 1 s, i.e. nearly every poll would still reach Postgres. 5 s keeps a
 * fresh tick visible well inside the 即時 window (2 × the 60 s poll), and
 * `expire` 60 s means a request after a quiet minute waits for fresh rows
 * instead of being served an old entry while it refreshes. Tagged with both
 * tags the job routes expire, so a finished job or a new tick is picked up
 * without waiting for the timer. Returns no `now`-derived values: phase,
 * age and labels are computed per request in the handler.
 */
export async function getLiveSources(): Promise<LiveSources> {
  "use cache";
  cacheLife({ stale: 5, revalidate: 5, expire: 60 });
  cacheTag(CACHE_TAGS.intraday, CACHE_TAGS.radarData);
  const [data, intraday] = await Promise.all([readDataSources(), readIntradayRow()]);
  return { ...data, intraday };
}
