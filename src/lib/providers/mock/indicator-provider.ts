import { db } from "@/lib/db";
import type { IndicatorProvider, IndicatorResult } from "@/lib/providers/types";
import { randomWalkStep } from "@/lib/providers/mock/random-walk";

/**
 * Demo mock provider: walks every existing Indicator forward one step from
 * its latest stored value. This stands in for a real scraper/API adapter
 * (TrendForce, Drewry, TWSE, ...) — swap this out per-indicator later
 * without touching any consuming code.
 */
export class MockIndicatorProvider implements IndicatorProvider {
  sourceKey = "mock-indicator-walker";

  async fetchLatest(): Promise<IndicatorResult[]> {
    const indicators = await db.indicator.findMany({
      include: { values: { orderBy: { date: "desc" }, take: 1 } },
    });

    const now = new Date();
    const results: IndicatorResult[] = [];

    for (const indicator of indicators) {
      const last = indicator.values[0];
      const base = last?.value ?? 100;
      const volatility = indicator.frequency === "daily" ? 1.5 : indicator.frequency === "weekly" ? 3 : 5;
      const next = randomWalkStep(base, volatility);
      results.push({ indicatorKey: indicator.key, date: now, value: next });
    }

    return results;
  }
}
