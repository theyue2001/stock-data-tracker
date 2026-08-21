import { db } from "@/lib/db";
import { utcDay } from "@/lib/dates";

/** How many sessions of industry flow the rules look back over. */
const FLOW_WINDOW = 20;

interface NewAlert {
  industryId: string | null;
  ruleKey: string;
  title: string;
  description: string;
  importance: "high" | "medium" | "low";
  sourceIndicator?: string;
  change?: string;
  explanation: string;
  stockIds?: string[];
}

/**
 * Rule-based alert engine (spec §7). Evaluates the latest data already in
 * the database (populated by the seed script / mock providers) against a
 * fixed set of rules and inserts new Alert rows. Idempotent per calendar
 * day + rule + industry so re-running the job repeatedly is safe.
 */
export async function runAlertEngine(referenceDate: Date = new Date()): Promise<number> {
  const today = utcDay(referenceDate);
  const candidates: NewAlert[] = [];

  const industries = await db.industry.findMany({
    include: {
      indicators: { include: { values: { orderBy: { date: "desc" }, take: 4 } } },
      // MUST filter by scope: an industry also owns its stocks' stock-scope
      // flow rows, and mixing them would compute streaks and turnover
      // averages over an interleaved series rather than the industry's own.
      flows: { where: { scope: "industry" }, orderBy: { date: "desc" }, take: FLOW_WINDOW },
      stocks: { include: { marketData: { orderBy: { date: "desc" }, take: 2 } } },
    },
  });

  for (const industry of industries) {
    // 1. Leading indicator rising for 2+ consecutive readings (SCFI-style rule,
    //    generalized to any "higherIsBetter" indicator on the industry).
    for (const indicator of industry.indicators) {
      const vals = indicator.values; // newest first
      if (vals.length >= 3 && indicator.higherIsBetter) {
        const rising = vals[0].value > vals[1].value && vals[1].value > vals[2].value;
        if (rising) {
          const totalChangePct = ((vals[0].value - vals[2].value) / vals[2].value) * 100;
          candidates.push({
            industryId: industry.id,
            ruleKey: `indicator_consecutive_rise:${indicator.key}`,
            title: `${indicator.name} rising for 2+ consecutive periods`,
            description: `${industry.name}: ${indicator.name} has risen for 2 consecutive readings, now ${vals[0].value.toFixed(2)}${
              indicator.unit ? ` ${indicator.unit}` : ""
            }.`,
            importance: Math.abs(totalChangePct) >= 5 ? "high" : "medium",
            sourceIndicator: indicator.name,
            change: `+${totalChangePct.toFixed(1)}%`,
            explanation: `A sustained rise in ${indicator.name} is a leading indicator that often precedes stock-price recognition for ${industry.name}.`,
          });
        }
      }

      // 2. Single-period spike > 5% on any indicator (freight-rate-style rule).
      if (vals.length >= 2) {
        const pct = vals[0].pctChange ?? ((vals[0].value - vals[1].value) / vals[1].value) * 100;
        if (Math.abs(pct) > 5) {
          candidates.push({
            industryId: industry.id,
            ruleKey: `indicator_spike:${indicator.key}`,
            title: `${indicator.name} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            description: `${industry.name}: ${indicator.name} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% in the latest reading.`,
            importance: Math.abs(pct) > 10 ? "high" : "medium",
            sourceIndicator: indicator.name,
            change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            explanation: `A single-period move greater than 5% in ${indicator.name} is large enough to reprice near-term industry expectations.`,
          });
        }
      }
    }

    // 3. Foreign investors net-buying an industry for 3+ consecutive sessions.
    const flows = industry.flows; // newest first
    if (flows.length >= 3) {
      let streak = 0;
      for (const f of flows) {
        if (f.foreignNet > 0) streak++;
        else break;
      }
      if (streak >= 3) {
        // A streak filling the whole query window may well be longer, so it is
        // reported as "N+" rather than claiming an exact count we cannot see.
        const truncated = streak === flows.length && flows.length === FLOW_WINDOW;
        const label = truncated ? `${streak}+` : String(streak);
        candidates.push({
          industryId: industry.id,
          ruleKey: "foreign_buy_streak",
          title: `Foreign investors net-bought ${industry.name} for ${label} straight sessions`,
          description: `Foreign institutional investors have been net buyers of ${industry.name} for ${label} consecutive sessions.`,
          importance: streak >= 5 ? "high" : "medium",
          sourceIndicator: "Foreign net flow",
          change: `${label} sessions`,
          explanation: "A multi-session foreign buying streak at the industry level suggests coordinated institutional accumulation rather than a single-stock event.",
        });
      }
    }

    // 4. Industry turnover spike vs. trailing average.
    if (flows.length >= 4) {
      const [latest, ...rest] = flows;
      const avgTurnover = rest.reduce((s, f) => s + f.turnover, 0) / rest.length;
      if (avgTurnover > 0 && latest.turnover > avgTurnover * 1.6) {
        candidates.push({
          industryId: industry.id,
          ruleKey: "turnover_spike",
          title: `${industry.name} turnover expanding sharply`,
          description: `${industry.name} turnover reached ${(latest.turnover / 1000).toFixed(0)}M, ${(
            (latest.turnover / avgTurnover - 1) * 100
          ).toFixed(0)}% above its recent average.`,
          importance: "medium",
          sourceIndicator: "Turnover",
          change: `${((latest.turnover / avgTurnover - 1) * 100).toFixed(0)}%`,
          explanation: "A sudden rise in industry-level turnover often signals new participants entering the theme, ahead of broader price recognition.",
        });
      }
    }

    // 5. Multiple stocks in the same industry breaking out together.
    const breakoutStocks = industry.stocks.filter((s) => s.marketData[0]?.technicalTrend === "breakout");
    if (breakoutStocks.length >= 3) {
      candidates.push({
        industryId: industry.id,
        ruleKey: "breakout_cluster",
        title: `${breakoutStocks.length} ${industry.name} stocks broke out together`,
        description: `${breakoutStocks.length} stocks in ${industry.name} (${breakoutStocks
          .map((s) => s.ticker)
          .join(", ")}) broke above consolidation ranges in the same session.`,
        importance: breakoutStocks.length >= 5 ? "high" : "medium",
        sourceIndicator: "Technical trend",
        change: `${breakoutStocks.length} stocks`,
        explanation: "A cluster breakout across multiple names in one industry is a stronger signal than any single stock's chart pattern alone.",
        stockIds: breakoutStocks.map((s) => s.id),
      });
    }

    // 6. Industry relative strength at a new high.
    const rsValues = industry.stocks.map((s) => s.marketData[0]?.relativeStrength ?? null).filter((v): v is number => v !== null);
    if (rsValues.length) {
      const maxRS = Math.max(...rsValues);
      if (maxRS >= 115) {
        candidates.push({
          industryId: industry.id,
          ruleKey: "relative_strength_new_high",
          title: `${industry.name} relative strength at a new high`,
          description: `${industry.name} stocks are showing relative strength up to ${maxRS.toFixed(0)} vs. the broader market (100 = inline).`,
          importance: "medium",
          sourceIndicator: "Relative strength",
          change: `RS ${maxRS.toFixed(0)}`,
          explanation: "Relative strength reaching a new high indicates the industry is outperforming the broader market, a hallmark of a strengthening leadership theme.",
        });
      }
    }
  }

  let created = 0;
  for (const c of candidates) {
    const exists = await db.alert.findFirst({
      where: {
        ruleKey: c.ruleKey,
        industryId: c.industryId,
        timestamp: { gte: today },
      },
    });
    if (exists) continue;

    await db.alert.create({
      data: {
        industryId: c.industryId,
        ruleKey: c.ruleKey,
        title: c.title,
        description: c.description,
        importance: c.importance,
        sourceIndicator: c.sourceIndicator,
        change: c.change,
        explanation: c.explanation,
        timestamp: referenceDate,
        stocks: c.stockIds
          ? { create: c.stockIds.map((stockId) => ({ stockId })) }
          : undefined,
      },
    });
    created++;
  }

  return created;
}
