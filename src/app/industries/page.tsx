import { IndustryRadarView } from "@/components/industries/industry-radar-view";
import { getIndustryRadar, getWatchlistKeys } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function IndustriesPage() {
  const [rows, watchKeys] = await Promise.all([getIndustryRadar(), getWatchlistKeys()]);

  return <IndustryRadarView rows={rows} watchedIds={watchKeys.industryIds} />;
}
