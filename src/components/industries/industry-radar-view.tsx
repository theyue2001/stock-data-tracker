"use client";

import { useMemo, useState } from "react";
import { FilterChip } from "@/components/radar/filter-chip";
import { PageHeader, PageShell } from "@/components/layout/page";
import { IndustryCard } from "@/components/industries/industry-card";
import type { IndustryRadarRow } from "@/lib/queries";
import type { IndustryStatus } from "@/lib/types";
import type { CardSentiment } from "@/components/industries/industry-card";

// The handoff's filter set is 全部/加速中/轉強/早期轉強/盤整/過熱/轉弱, but
// IndustryStatus (src/lib/types.ts) only models 5 states — there is no
// industry-level "early strengthening" distinct from "strengthening" in the
// real scoring pipeline (that granularity only exists for stocks). Showing a
// chip that can never match anything would be a broken control, so this
// screen renders the 5 real statuses plus 全部 instead of a non-functional
// 7th chip — a genuine schema constraint per AGENTS.md, not a stylistic cut.
const STATUS_FILTERS: Array<{ value: IndustryStatus | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "accelerating", label: "加速中" },
  { value: "strengthening", label: "轉強" },
  { value: "neutral", label: "盤整" },
  { value: "overheated", label: "過熱" },
  { value: "weakening", label: "轉弱" },
];

type SortMode = "heat" | "delta" | "sentiment";

export function IndustryRadarView({
  rows,
  watchedIds,
  sentimentById,
}: {
  rows: IndustryRadarRow[];
  watchedIds: Set<string>;
  /** Short-term sentiment per industry id. Empty until the sentiment job has
   *  run at least once — cards then simply omit the 氣氛 line rather than
   *  showing a fabricated zero. */
  sentimentById: Record<string, CardSentiment>;
}) {
  const [status, setStatus] = useState<IndustryStatus | "all">("all");
  const [sort, setSort] = useState<SortMode>("heat");

  const ranked = useMemo(() => {
    const byToday = [...rows].sort((a, b) => b.scoreToday - a.scoreToday);
    const byWeekAgo = [...rows].sort((a, b) => b.scoreWeekAgo - a.scoreWeekAgo);
    const rankToday = new Map(byToday.map((r, i) => [r.id, i + 1]));
    const rankWeekAgo = new Map(byWeekAgo.map((r, i) => [r.id, i + 1]));
    return byToday.map((r) => ({ row: r, rank: rankToday.get(r.id)!, rankDelta: rankWeekAgo.get(r.id)! - rankToday.get(r.id)! }));
  }, [rows]);

  const filtered = useMemo(() => {
    const subset = status === "all" ? ranked : ranked.filter((r) => r.row.status === status);
    if (sort === "delta") return [...subset].sort((a, b) => Math.abs(b.rankDelta) - Math.abs(a.rankDelta));
    if (sort === "sentiment") {
      return [...subset].sort(
        (a, b) => (sentimentById[b.row.id]?.score ?? -1) - (sentimentById[a.row.id]?.score ?? -1),
      );
    }
    return subset;
  }, [ranked, status, sort, sentimentById]);

  return (
    <PageShell>
      <PageHeader title="產業雷達" note="HEAT 0–100" subtitle={`${rows.length} 個產業 · 2–3 秒讀懂一張卡`} />

      {/* Filters get their own box. On a phone they wrap to three or four rows,
          and without an edge around them they read as page content rather than
          as the control that changes what is below. */}
      <div className="rd-card rd-card-body mb-3 flex flex-col gap-2.5 sm:mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">狀態</span>
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.value} label={f.label} active={status === f.value} onClick={() => setStatus(f.value)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">排序</span>
          <FilterChip label="依熱度" active={sort === "heat"} onClick={() => setSort("heat")} />
          <FilterChip label="依排名變化" active={sort === "delta"} onClick={() => setSort("delta")} />
          <FilterChip label="依短線氣氛" active={sort === "sentiment"} onClick={() => setSort("sentiment")} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-3.5 xl:grid-cols-3">
        {filtered.map(({ row, rank, rankDelta }) => (
          <IndustryCard
            key={row.id}
            row={row}
            rank={rank}
            rankDelta={rankDelta}
            watched={watchedIds.has(row.id)}
            sentiment={sentimentById[row.id] ?? null}
          />
        ))}
      </div>

      {filtered.length === 0 && <p className="py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">沒有符合篩選條件的產業。</p>}
    </PageShell>
  );
}
