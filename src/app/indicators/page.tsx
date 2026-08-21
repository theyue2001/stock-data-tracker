import { IndicatorExplorer } from "@/components/indicators/indicator-explorer";
import { getIndicatorOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function IndicatorsPage() {
  const rows = await getIndicatorOverview();
  return <IndicatorExplorer rows={rows} />;
}
