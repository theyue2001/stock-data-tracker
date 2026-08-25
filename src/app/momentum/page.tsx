import { PageHeader, PageShell } from "@/components/layout/page";
import { IndustryMomentum } from "@/components/sentiment/industry-momentum";
import { getWatchlistKeys } from "@/lib/queries";
import { getIndustryMomentum, industryToTableRow, subIndustryToTableRow } from "@/lib/sentiment-queries";

/**
 * 產業氣氛 — the full three-tab momentum table.
 *
 * Used to be the largest block on the overview, where it buried every other
 * reading under a ten-column table. The overview now shows its top five and
 * links here; this is where the whole universe, the 空方 side and the
 * sub-industry breakdown live.
 */
export default async function MomentumPage() {
  const [momentum, watchKeys] = await Promise.all([getIndustryMomentum(), getWatchlistKeys()]);

  return (
    <PageShell>
      <PageHeader
        title="產業氣氛"
        note="SENTIMENT 0–100"
        subtitle="今天這個族群是不是「整體」在動 — 廣度、量能、法人參與、相對強度。與中期產業熱度分開計算，兩者不互相取代。"
      />

      {momentum.date ? (
        <IndustryMomentum
          date={momentum.date}
          industryRows={momentum.industries.map(industryToTableRow)}
          subIndustryRows={momentum.subIndustries.map(subIndustryToTableRow)}
          watchedIndustryIds={[...watchKeys.industryIds]}
        />
      ) : (
        <div className="rd-card rd-card-body">
          <p className="text-[12px] leading-[1.7] text-[var(--rd-text-secondary)]">
            尚無氣氛值資料 — 執行 <code>npm run jobs:refresh</code>（或 <code>npm run db:reset</code> 重建含歷史的示範資料集）。
          </p>
        </div>
      )}
    </PageShell>
  );
}
