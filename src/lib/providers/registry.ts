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
