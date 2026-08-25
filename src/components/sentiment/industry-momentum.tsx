"use client";

import { useMemo, useState } from "react";
import { FilterChip } from "@/components/radar/filter-chip";
import { StatusChip } from "@/components/radar/status-chip";
import { ClickableRow } from "@/components/radar/clickable-row";
import { WatchStar } from "@/components/radar/watch-star";
import { HeatBar } from "@/components/radar/heat-bar";
import { BreadthBar, BreadthCounts } from "@/components/sentiment/breadth-bar";
import { RankChange } from "@/components/sentiment/rank-change";
import { SentimentSpark } from "@/components/sentiment/sentiment-spark";
import { pct } from "@/lib/format";
import { directionColor } from "@/lib/radar-ui";
import {
  FLOW_SOURCE_NOTE,
  SENTIMENT_STATUS_BADGE,
  institutionWord,
  sentimentBarColor,
  sentimentTextColor,
  sentimentTrendGlyph,
  volumeWord,
} from "@/lib/sentiment-ui";
import type { MomentumTableRow } from "@/lib/sentiment-queries";

// ---------------------------------------------------------------------------
// 產業氣氛 / INDUSTRY MOMENTUM
//
// Three tabs over one sortable table. Every number rendered here was computed
// in src/lib/sentiment.ts and stored/derived by
// src/lib/jobs/compute-sentiment.ts — this component owns layout, sorting and
// tab state only, and never re-derives a score or hard-codes a weight.
// ---------------------------------------------------------------------------

type TabKey = "bull" | "bear" | "sub";

/** The split point between 多方 and 空方. 50 is the neutral reading of every
 *  component normalizer (see src/lib/sentiment.ts), so it is the score at
 *  which a group is neither participating nor lagging — not an arbitrary cut. */
const NEUTRAL_SCORE = 50;

const COLUMNS = "26px minmax(140px,1fr) 78px 152px 132px 56px 108px 78px 132px 88px";

type SortKey = "return" | "score" | "breadth" | "volume" | "flow" | "rs" | "rank";

const SORT_ACCESSOR: Record<SortKey, (r: MomentumTableRow) => number> = {
  return: (r) => r.averageReturnPct,
  score: (r) => r.sentimentScore,
  breadth: (r) => (r.stockCount ? r.advancingCount / r.stockCount : 0),
  volume: (r) => r.volumeRatio,
  // Same half-weight on dealer flow the score itself applies, so the column
  // sorts by the figure it displays rather than a different one.
  flow: (r) => r.foreignNet + r.trustNet + r.dealerNet * 0.5,
  rs: (r) => r.relativeStrengthPct,
  rank: (r) => r.rankDelta,
};

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const TAB_DEFAULT_SORT: Record<TabKey, SortState> = {
  bull: { key: "score", dir: "desc" },
  bear: { key: "score", dir: "asc" },
  sub: { key: "score", dir: "desc" },
};

export function IndustryMomentum({
  industryRows,
  subIndustryRows,
  date,
  watchedIndustryIds,
}: {
  industryRows: MomentumTableRow[];
  subIndustryRows: MomentumTableRow[];
  date: string | null;
  watchedIndustryIds: string[];
}) {
  const [tab, setTab] = useState<TabKey>("bull");
  const [sort, setSort] = useState<SortState>(TAB_DEFAULT_SORT.bull);
  const watched = useMemo(() => new Set(watchedIndustryIds), [watchedIndustryIds]);

  const bullRows = useMemo(() => industryRows.filter((r) => r.sentimentScore >= NEUTRAL_SCORE), [industryRows]);
  const bearRows = useMemo(() => industryRows.filter((r) => r.sentimentScore < NEUTRAL_SCORE), [industryRows]);

  const rows = tab === "bull" ? bullRows : tab === "bear" ? bearRows : subIndustryRows;

  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSOR[sort.key];
    return [...rows].sort((a, b) => {
      const diff = accessor(a) - accessor(b);
      // Rank is the stable tiebreak so equal values never reshuffle between
      // renders (e.g. every row with a 0 rank delta).
      if (diff === 0) return a.rank - b.rank;
      return sort.dir === "desc" ? -diff : diff;
    });
  }, [rows, sort]);

  const selectTab = (next: TabKey) => {
    setTab(next);
    setSort(TAB_DEFAULT_SORT[next]);
  };

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  };

  const accelerating = industryRows.filter((r) => r.status === "accelerating").length;
  const strongCluster = industryRows.filter((r) => r.status === "strong_cluster").length;
  const overheated = industryRows.filter((r) => r.status === "overheated").length;

  return (
    <div>
      <div className="rd-rule flex flex-wrap items-baseline gap-2.5 pt-2.5">
        <span className="text-[13px] font-bold">產業氣氛</span>
        <span className="font-mono text-[9px] tracking-[.16em] text-[var(--rd-text-muted)]">INDUSTRY MOMENTUM</span>
        <span className="text-[10px] text-[var(--rd-text-secondary)]">短線市場強度 · 廣度 · 參與度（0–100，與中期產業熱度分開計算）</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">{date ?? "—"} · 點列開產業雷達</span>
      </div>

      {/* breadth summary — real counts, not copy */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 py-2.5 text-[11px]">
        <SummaryStat label="多方族群" value={bullRows.length} total={industryRows.length} color="#ff5a3d" />
        <SummaryStat label="空方族群" value={bearRows.length} total={industryRows.length} color="#3dae7c" />
        <SummaryStat label="加速轉強" value={accelerating} color="#ffc4b8" />
        <SummaryStat label="強勢群聚" value={strongCluster} color="#ff9783" />
        <SummaryStat label="短線過熱" value={overheated} color="#e6c26a" />
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <FilterChip label={`多方 ${bullRows.length}`} active={tab === "bull"} onClick={() => selectTab("bull")} />
        <FilterChip label={`空方 ${bearRows.length}`} active={tab === "bear"} onClick={() => selectTab("bear")} />
        <FilterChip label={`細產業 ${subIndustryRows.length}`} active={tab === "sub"} onClick={() => selectTab("sub")} />
        <span className="ml-auto text-[10px] text-[var(--rd-text-muted)]">點欄位標題排序 · 紅漲綠跌</span>
      </div>

      {tab === "sub" && (
        <p className="pb-2.5 text-[10px] leading-[1.6] text-[var(--rd-text-muted)]">
          細產業以相同公式計算，但成分股較少（部分僅 1–2 檔），漲跌家數與突破家數等廣度分項因此更容易走極端、排名波動也較大 — 請對照「漲跌家數」欄的實際檔數解讀。
        </p>
      )}

      <div className="scrollbar-thin overflow-x-auto">
        <div style={{ minWidth: 980 }}>
          <div
            className="grid items-center py-2.5 pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)]"
            style={{ gridTemplateColumns: COLUMNS, columnGap: 6, borderBottom: "1px solid var(--rd-rule)" }}
          >
            <span />
            <span>{tab === "sub" ? "細產業" : "產業"}</span>
            <SortHeader label="今日漲跌" sortKey="return" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="氣氛值" sortKey="score" sort={sort} onSort={toggleSort} />
            <SortHeader label="漲跌家數" sortKey="breadth" sort={sort} onSort={toggleSort} />
            <SortHeader label="量能" sortKey="volume" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="法人" sortKey="flow" sort={sort} onSort={toggleSort} />
            <SortHeader label="相對強度" sortKey="rs" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="排名變化" sortKey="rank" sort={sort} onSort={toggleSort} />
            <span>狀態</span>
          </div>

          {sorted.map((r) => {
            const badge = SENTIMENT_STATUS_BADGE[r.status];
            const vol = volumeWord(r.volumeRatio);
            const inst = institutionWord(r.foreignNet, r.trustNet, r.dealerNet);
            const flowNote = FLOW_SOURCE_NOTE[r.flowSource] ?? null;
            const trend = sentimentTrendGlyph(r.scoreDelta);
            // Highlight the acceleration cases the module exists to surface.
            const highlighted = r.rankDelta >= 4 || r.status === "accelerating";

            return (
              <ClickableRow
                key={r.key}
                href={r.href}
                className="rd-hairline grid items-center py-2"
                style={{
                  gridTemplateColumns: COLUMNS,
                  columnGap: 6,
                  background: highlighted ? "rgba(255,86,60,.06)" : "transparent",
                }}
              >
                <span className="flex items-center justify-center">
                  {r.industryId ? (
                    <WatchStar itemType="industry" targetId={r.industryId} initialActive={watched.has(r.industryId)} />
                  ) : null}
                </span>

                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-bold">{r.label}</span>
                  {r.sublabel && (
                    <span className="truncate text-[9.5px] font-medium text-[var(--rd-text-muted)]">{r.sublabel}</span>
                  )}
                </span>

                <span className="tnum text-right text-[12.5px] font-bold" style={{ color: directionColor(r.averageReturnPct) }}>
                  {pct(r.averageReturnPct)}
                </span>

                <span className="flex items-center gap-2">
                  <HeatBar score={r.sentimentScore} color={sentimentBarColor(r.sentimentScore, r.status)} width={44} />
                  <span className="tnum text-[13px] font-bold" style={{ color: sentimentTextColor(r.sentimentScore) }}>
                    {r.sentimentScore.toFixed(0)}
                  </span>
                  <span className="tnum text-[10px] font-semibold" style={{ color: trend.color }} title="與前一交易日相比">
                    {trend.glyph}
                    {r.scoreDelta !== 0 && Math.abs(r.scoreDelta).toFixed(0)}
                  </span>
                  {r.sentimentTrend.length > 1 && (
                    <SentimentSpark points={r.sentimentTrend} color={sentimentBarColor(r.sentimentScore, r.status)} width={40} height={16} />
                  )}
                </span>

                <span className="flex items-center gap-2">
                  <BreadthBar advancing={r.advancingCount} flat={r.flatCount} declining={r.decliningCount} width={46} />
                  <BreadthCounts advancing={r.advancingCount} flat={r.flatCount} declining={r.decliningCount} />
                </span>

                <span className="tnum text-right text-[11.5px] font-semibold" style={{ color: vol.color }}>
                  {vol.label}
                </span>

                <span className="flex items-baseline gap-1 truncate text-[11.5px] font-medium" style={{ color: inst.color }}>
                  <span className="truncate">{inst.label}</span>
                  {flowNote && (
                    <span
                      className="shrink-0 px-1 text-[8.5px] font-semibold text-[var(--rd-text-muted)]"
                      style={{ border: "1px solid rgba(243,242,242,.25)" }}
                      title={flowNote.title}
                    >
                      {flowNote.label}
                    </span>
                  )}
                </span>

                <span className="tnum text-right text-[11.5px] font-semibold" style={{ color: directionColor(r.relativeStrengthPct) }}>
                  {pct(r.relativeStrengthPct, 1)}
                </span>

                <span>
                  <RankChange rank={r.rank} previousRank={r.previousRank} delta={r.rankDelta} />
                </span>

                <StatusChip badge={badge} compact />
              </ClickableRow>
            );
          })}

          {sorted.length === 0 && (
            <p className="py-8 text-center text-[12px] text-[var(--rd-text-secondary)]">
              {tab === "bear"
                ? "本日沒有氣氛值低於 50 的產業 — 短線市場廣度全面偏多。"
                : tab === "bull"
                  ? "本日沒有氣氛值達 50 以上的產業 — 短線市場廣度全面偏弱。"
                  : "尚無細產業分類資料。"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, total, color }: { label: string; value: number; total?: number; color: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      <span className="tnum text-[13px] font-bold" style={{ color }}>
        {value}
      </span>
      {total !== undefined && <span className="tnum text-[10px] text-[var(--rd-text-muted)]">/ {total}</span>}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      // The table is a CSS grid, not a <table>/role="grid", so there is no
      // columnheader to carry aria-sort. The state goes in the accessible
      // name instead, which conveys the same thing to a screen reader
      // without misapplying ARIA to a button role.
      aria-label={`${label}，${active ? (sort.dir === "desc" ? "目前由高至低排序" : "目前由低至高排序") : "點擊以排序"}`}
      className="flex cursor-pointer items-center gap-1 text-[10px] font-medium transition-colors"
      style={{
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        color: active ? "var(--rd-accent-word)" : "var(--rd-text-muted)",
      }}
    >
      <span>{label}</span>
      <span className="font-mono text-[8px]">{active ? (sort.dir === "desc" ? "▼" : "▲") : "◇"}</span>
    </button>
  );
}
