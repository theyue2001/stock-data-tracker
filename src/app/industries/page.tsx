import { IndustryRadarView } from "@/components/industries/industry-radar-view";
import { getIndustryRadar, getWatchlistKeys } from "@/lib/queries";
import { getIndustryMomentum } from "@/lib/sentiment-queries";

export default async function IndustriesPage() {
  const [rows, watchKeys, momentum] = await Promise.all([
    getIndustryRadar(),
    getWatchlistKeys(),
    getIndustryMomentum(),
  ]);

  // Each card carries its short-term sentiment alongside its medium-term heat
  // score, keyed by industry id. Sent as a plain record rather than a Map so
  // it crosses the server/client boundary unchanged.
  const sentimentById = Object.fromEntries(
    momentum.industries.map((s) => [
      s.id,
      { score: s.sentimentScore, delta: s.scoreDelta, rank: s.rank, previousRank: s.previousRank, rankDelta: s.rankDelta, status: s.status },
    ]),
  );

  return <IndustryRadarView rows={rows} watchedIds={watchKeys.industryIds} sentimentById={sentimentById} />;
}
