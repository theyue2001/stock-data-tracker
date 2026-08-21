import { MockIndicatorProvider } from "@/lib/providers/mock/indicator-provider";
import { MockInstitutionalFlowProvider } from "@/lib/providers/mock/flow-provider";
import type { IndicatorProvider, InstitutionalFlowProvider } from "@/lib/providers/types";

/**
 * Central registry of active providers. For MVP this only wires the mock
 * implementations. To go live, add a new provider class implementing the
 * same interface (e.g. TwseIndicatorProvider) and list it here instead —
 * nothing in the API routes, scoring, or UI layers needs to change.
 */
export const indicatorProviders: IndicatorProvider[] = [new MockIndicatorProvider()];

export const institutionalFlowProviders: InstitutionalFlowProvider[] = [
  new MockInstitutionalFlowProvider(),
];
