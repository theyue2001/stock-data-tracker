import { db } from "@/lib/db";
import type { InstitutionalFlowProvider, InstitutionalFlowResult } from "@/lib/providers/types";
import { randomBetween } from "@/lib/providers/mock/random-walk";

/**
 * Demo mock provider for foreign/trust/dealer net flow, per industry.
 *
 * The generated flow is CORRELATED with the industry's actual latest-session
 * price and volume action rather than drawn independently. Uncorrelated noise
 * would routinely claim institutions accumulated a group that fell, which
 * contradicts the premise the whole product rests on — that capital flow and
 * price action inform each other. A real TWSE adapter naturally has this
 * property; the mock has to be built to preserve it.
 */
export class MockInstitutionalFlowProvider implements InstitutionalFlowProvider {
  sourceKey = "mock-flow";

  async fetchLatest(): Promise<InstitutionalFlowResult[]> {
    const industries = await db.industry.findMany({
      include: {
        stocks: { include: { marketData: { orderBy: { date: "desc" }, take: 21 } } },
      },
    });
    const now = new Date();

    return industries.map((industry) => {
      const latest = industry.stocks.map((s) => s.marketData[0]).filter(Boolean);

      // Equal-weighted industry move for the session.
      const avgChangePct = latest.length ? latest.reduce((sum, m) => sum + m.changePct, 0) / latest.length : 0;

      // Volume relative to each stock's own trailing average, averaged up.
      const volumeRatios = industry.stocks
        .map((s) => {
          const [head, ...prior] = s.marketData;
          if (!head || prior.length < 5) return null;
          const avg = prior.reduce((sum, m) => sum + m.volume, 0) / prior.length;
          return avg > 0 ? head.volume / avg : null;
        })
        .filter((v): v is number => v !== null);
      const avgVolumeRatio = volumeRatios.length
        ? volumeRatios.reduce((a, b) => a + b, 0) / volumeRatios.length
        : 1;

      // Direction follows price; conviction scales with volume participation.
      const direction = Math.max(-1, Math.min(1, avgChangePct / 1.8));
      const conviction = Math.max(0.35, Math.min(2, avgVolumeRatio));
      const bias = direction * conviction;
      const turnoverBase = latest.reduce((sum, m) => sum + m.close * m.volume, 0) / 1000; // NT$ thousands

      return {
        date: now,
        scope: "industry" as const,
        industryKey: industry.slug,
        foreignNet: Math.round(bias * randomBetween(40000, 190000)),
        trustNet: Math.round(bias * randomBetween(10000, 62000)),
        // Dealers are market-makers, so their net is smaller and noisier.
        dealerNet: Math.round(bias * randomBetween(-14000, 34000)),
        marginChange: Math.round(bias * randomBetween(-6000, 20000)),
        turnover: Math.round(turnoverBase || randomBetween(300000, 4000000)),
        volumeChangePct: Math.round((avgVolumeRatio - 1) * 1000) / 10,
        // breakoutCount is intentionally omitted: a real flow feed does not
        // report it, and the refresh job derives it from actual price data.
      };
    });
  }
}
