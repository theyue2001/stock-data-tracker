import { MockIndicatorProvider } from "@/lib/providers/mock/indicator-provider";
import { MockInstitutionalFlowProvider } from "@/lib/providers/mock/flow-provider";
import { TwseMarketDataProvider } from "@/lib/providers/live/market-data-provider";
import { TwseInstitutionalFlowProvider } from "@/lib/providers/live/flow-provider";
import { TwseMarketStatusProvider } from "@/lib/providers/live/market-status-provider";
import { MopsFundamentalProvider } from "@/lib/providers/live/fundamental-provider";
import { MopsCatalystProvider } from "@/lib/providers/live/catalyst-provider";
import { TwseMisIndexProvider } from "@/lib/providers/live/intraday-provider";
import {
  DerivedOdmRevenueProvider,
  SecHyperscalerCapexProvider,
} from "@/lib/providers/live/indicator-provider";
import type {
  FundamentalProvider,
  IndicatorProvider,
  IntradayIndexProvider,
  IntradayQuoteProvider,
  InstitutionalFlowProvider,
  MarketDataProvider,
  MarketStatusProvider,
  NewsProvider,
} from "@/lib/providers/types";

/**
 * Central registry of active providers.
 *
 * Live is the default. `DATA_MODE=mock` swaps in the synthetic generators,
 * which is what the demo dataset and offline development use — the two modes
 * are kept mutually exclusive on purpose, because a half-live dataset (real
 * prices, invented flows) is the one outcome worse than either.
 *
 * Nothing downstream of this file knows which mode is active: the API routes,
 * scoring, and UI all read provenance off the stored rows instead.
 */

export type DataMode = "live" | "mock";

export const dataMode: DataMode = process.env.DATA_MODE === "mock" ? "mock" : "live";

const live = dataMode === "live";

export const marketDataProviders: MarketDataProvider[] = live ? [new TwseMarketDataProvider()] : [];

export const marketStatusProviders: MarketStatusProvider[] = live ? [new TwseMarketStatusProvider()] : [];

/** Separate from marketStatusProviders: this is the only registry entry that
 *  reads a mid-session feed rather than an after-hours report, and it is
 *  driven by its own lightweight job (refresh-intraday.ts), not runRefreshJob. */
export const intradayIndexProviders: IntradayIndexProvider[] = live ? [new TwseMisIndexProvider()] : [];

/**
 * Per-stock real-time quotes: deliberately EMPTY until a licensed feed is
 * contracted. This is the slot an industry "price movement every 10–30 s"
 * view would read, and it is not filled from mis.twse.com.tw for two reasons:
 *
 *  - Licensing. TWSE holds the IP in its trading information and requires its
 *    consent and a written contract before anyone 「加值後提供傳輸、傳播或供他人
 *    使用」 (TWSE FAQ, https://www.twse.com.tw/zh/products/information/qa.html).
 *    The 基本市況報導 site is free to VIEW; a server polling it per stock and
 *    re-serving the result to dashboard users is redistribution.
 *  - Rate. MIS is a public viewing page with no published allowance for
 *    automated clients, and its own payload asks a single browser to refresh
 *    no more often than `userDelay` (5000 ms). Even batched into one request
 *    per poll, a collector hitting it every 10–30 s for the whole session is
 *    sustained automated load on a host family whose interactive site
 *    IP-blocks bursty clients (see live/http.ts).
 *
 * The index-level MIS poll above stays at minute cadence for the same reasons
 * (see TwseMisIndexProvider.minIntervalSeconds).
 *
 * Wiring in a licensed vendor takes more than an entry here:
 *  1. a class implementing IntradayQuoteProvider with the contracted
 *     `minIntervalSeconds` and `delayedSeconds`;
 *  2. an `IntradayQuote` table (latest quote per stock and session) and its
 *     migration — nothing stores per-stock intraday data today, and the daily
 *     MarketData rows must not be overwritten mid-session;
 *  3. an industry-movement aggregation (member stocks → industry change, with
 *     the weighting chosen explicitly) behind its own cache tag;
 *  4. a dataset key in the job log and a leg in the scheduler's intraday loop.
 * All four are out of scope until a feed is licensed.
 */
export const intradayQuoteProviders: IntradayQuoteProvider[] = [];

/**
 * The slowest poll any registered intraday source allows, in seconds: the
 * floor under INTRADAY_INTERVAL_SECONDS and under back-to-back calls to the
 * intraday job. 0 when no intraday source is registered (DATA_MODE=mock).
 */
export function intradayPollFloorSeconds(): number {
  return Math.max(
    0,
    ...intradayIndexProviders.map((p) => p.minIntervalSeconds),
    ...intradayQuoteProviders.map((p) => p.minIntervalSeconds),
  );
}

export const institutionalFlowProviders: InstitutionalFlowProvider[] = live
  ? [new TwseInstitutionalFlowProvider()]
  : [new MockInstitutionalFlowProvider()];

export const fundamentalProviders: FundamentalProvider[] = live ? [new MopsFundamentalProvider()] : [];

export const newsProviders: NewsProvider[] = live ? [new MopsCatalystProvider()] : [];

/**
 * Indicator coverage is deliberately partial in live mode. Only the series
 * with a free authoritative source are wired; the licensed ones (SCFI, DRAM
 * contract pricing, SEMI billings, panel pricing, ...) are loaded through
 * `npm run import:indicators` instead of being approximated by a proxy that
 * would silently change what the indicator means.
 */
export const indicatorProviders: IndicatorProvider[] = live
  ? [new SecHyperscalerCapexProvider(), new DerivedOdmRevenueProvider()]
  : [new MockIndicatorProvider()];
