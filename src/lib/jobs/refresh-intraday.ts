import { intradayIndexProviders } from "@/lib/providers/registry";
import { ensureDataSource, writeIntradayIndex } from "@/lib/jobs/persist";

export interface IntradayRefreshSummary {
  ticks: number;
}

/**
 * The minute-cadence sibling of runRefreshJob. Deliberately its own job, not
 * a branch inside the daily pipeline: it polls one lightweight endpoint and
 * writes one row, so it can run every minute during the session without
 * paying for alerts, the daily brief, or a scores recompute on every tick.
 */
export async function runIntradayRefreshJob(): Promise<IntradayRefreshSummary> {
  let ticks = 0;
  for (const provider of intradayIndexProviders) {
    const sourceId = await ensureDataSource(provider.source);
    const results = await provider.fetchLatest();
    ticks += await writeIntradayIndex(results, sourceId, provider.source.isMock);
  }
  return { ticks };
}
