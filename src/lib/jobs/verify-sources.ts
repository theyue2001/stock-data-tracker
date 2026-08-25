import { loadTrackedStocks } from "@/lib/jobs/persist";
import { TwseMarketDataProvider } from "@/lib/providers/live/market-data-provider";
import { TwseMarketStatusProvider } from "@/lib/providers/live/market-status-provider";
import { TwseInstitutionalFlowProvider } from "@/lib/providers/live/flow-provider";
import { MopsFundamentalProvider } from "@/lib/providers/live/fundamental-provider";
import { MopsCatalystProvider } from "@/lib/providers/live/catalyst-provider";
import { SecHyperscalerCapexProvider } from "@/lib/providers/live/indicator-provider";

/**
 * Read-only shape check across every live feed.
 *
 * The failure mode this exists for is specific and nasty: these are public
 * reports, not versioned APIs, so a column reorder or a renamed field does not
 * raise an error — it produces a plausible-looking wrong number. This project
 * has already shipped one (market turnover read from 成交股數 instead of
 * 成交金額, which rendered as a perfectly believable "88 億"). Nothing in the
 * pipeline would have caught it; only asserting the shape does.
 *
 * Writes nothing, so it is safe to run on a schedule and safe to run against
 * production.
 */

export interface SourceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  checks: SourceCheck[];
  passed: number;
  failed: number;
}

/** Runs `probe`, turning a thrown error into a failed check rather than
 *  aborting the rest of the suite — one dead feed should not hide the state of
 *  the others. */
async function check(name: string, probe: () => Promise<SourceCheck>): Promise<SourceCheck> {
  try {
    return await probe();
  } catch (error) {
    return { name, ok: false, detail: `threw: ${(error as Error).message.slice(0, 200)}` };
  }
}

export async function runSourceVerification(): Promise<VerificationResult> {
  const stocks = await loadTrackedStocks();
  const checks: SourceCheck[] = [];

  checks.push(
    await check("market-status", async () => {
      const [s] = await new TwseMarketStatusProvider().fetchLatest();
      // Turnover is asserted against a floor because that is exactly the bug
      // class this catches: TAIEX turnover is hundreds of billions of NT$, so a
      // share count (~1e10) or a 仟元 figure would both fall outside the band.
      const plausibleTurnover = !!s && s.volume > 1e11 && s.volume < 1e13;
      return {
        name: "market-status",
        ok: !!s && s.close > 1000 && plausibleTurnover,
        detail: s
          ? `${s.date.toISOString().slice(0, 10)} close ${s.close} turnover ${(s.volume / 1e8).toFixed(0)}億 breadth ${s.breadthAdvancers ?? "n/a"}/${s.breadthDecliners ?? "n/a"}`
          : "no rows",
      };
    }),
  );

  checks.push(
    await check("prices", async () => {
      const quotes = await new TwseMarketDataProvider().fetchLatest(stocks);
      const sane = quotes.every((q) => q.close > 0 && q.high >= q.low && q.volume >= 0);
      return {
        name: "prices",
        ok: quotes.length > stocks.length * 0.8 && sane,
        detail: `${quotes.length}/${stocks.length} stocks, OHLC coherent: ${sane}`,
      };
    }),
  );

  checks.push(
    await check("institutional-flow", async () => {
      const flows = await new TwseInstitutionalFlowProvider().fetchLatest(stocks);
      const active = flows.filter((f) => f.foreignNet !== 0 || f.trustNet !== 0 || f.dealerNet !== 0);
      return {
        name: "institutional-flow",
        ok: flows.length > stocks.length * 0.5 && active.length > 0,
        detail: `${flows.length} rows, ${active.length} with activity`,
      };
    }),
  );

  checks.push(
    await check("fundamentals", async () => {
      const rows = await new MopsFundamentalProvider().fetchLatest(stocks);
      const revenue = rows.filter((r) => r.periodType === "monthly_revenue");
      const eps = rows.filter((r) => r.periodType === "quarterly_eps");
      return {
        name: "fundamentals",
        ok: revenue.length > stocks.length * 0.5 && eps.length > 0,
        detail: `${revenue.length} revenue + ${eps.length} EPS rows`,
      };
    }),
  );

  checks.push(
    await check("catalysts", async () => {
      const rows = await new MopsCatalystProvider().fetchLatest(stocks);
      return {
        // A quiet filing day is legitimate, so presence is reported, not asserted.
        name: "catalysts",
        ok: true,
        detail: rows.length ? `${rows.length} filings` : "no filings today (normal)",
      };
    }),
  );

  checks.push(
    await check("hyperscaler-capex", async () => {
      const points = await new SecHyperscalerCapexProvider().fetchLatest();
      const last = points[points.length - 1];
      return {
        name: "hyperscaler-capex",
        ok: points.length > 4 && (last?.value ?? 0) > 0,
        detail: last ? `${points.length} quarters, latest US$${last.value}bn` : "no data",
      };
    }),
  );

  const failed = checks.filter((c) => !c.ok).length;
  return { checks, passed: checks.length - failed, failed };
}
