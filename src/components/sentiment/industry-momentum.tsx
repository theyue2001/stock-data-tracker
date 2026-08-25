"use client";

import { useMemo, useState } from "react";
import { FilterChip } from "@/components/radar/filter-chip";
import { StatusChip } from "@/components/radar/status-chip";
import { ClickableRow } from "@/components/radar/clickable-row";
import { WatchStar } from "@/components/radar/watch-star";
import { HeatBar } from "@/components/radar/heat-bar";
import { Panel, PanelRows } from "@/components/radar/panel";
import { BreadthBar, BreadthCounts } from "@/components/sentiment/breadth-bar";
import { RankChange } from "@/components/sentiment/rank-change";
import { SentimentSpark } from "@/components/sentiment/sentiment-spark";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
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
// Three tabs over one dataset. Every number rendered here was computed in
// src/lib/sentiment.ts and stored/derived by
// src/lib/jobs/compute-sentiment.ts — this component owns layout, sorting and
// tab state only, and never re-derives a score or hard-codes a weight.
//
// Two renderings of the same rows: a 10-column table from `lg` up, and one
// card per row below it. The table cannot reflow — its columns carry meaning
// by position — and squeezing ten of them into 390px is what clipped industry
// names to a single character, so on a phone each row becomes its own box
// instead.
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

const SORT_LABEL: Record<SortKey, string> = {
  return: "今日漲跌",
  score: "氣氛值",
  breadth: "漲跌家數",
  volume: "量能",
  flow: "法人",
  rs: "相對強度",
  rank: "排名變化",
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
  // Which side to open on. Not a preference — on a broadly weak session 多方 is
  // empty, and opening an empty tab reads as "no data" rather than "the whole
  // market is on the other side".
  const initialTab: TabKey = useMemo(() => {
    if (industryRows.some((r) => r.sentimentScore >= NEUTRAL_SCORE)) return "bull";
    if (industryRows.length) return "bear";
    return "bull";
  }, [industryRows]);

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [sort, setSort] = useState<SortState>(TAB_DEFAULT_SORT[initialTab]);
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

  const emptyNote =
    tab === "bear"
      ? "本日沒有氣氛值低於 50 的產業 — 短線市場廣度全面偏多。"
      : tab === "bull"
        ? "本日沒有氣氛值達 50 以上的產業 — 短線市場廣度全面偏弱。"
        : "尚無細產業分類資料。";

  return (
    <Panel
      title="族群明細"
      kicker="ALL GROUPS"
      note={`${date ?? "—"} · 短線強度 / 廣度 / 參與度 0–100 · 與中期熱度分開計算`}
      flush
    >
      {/* breadth summary — real counts, not copy */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 pt-3 sm:px-3.5">
        <SummaryStat label="多方族群" value={bullRows.length} total={industryRows.length} color="#ff5a3d" />
        <SummaryStat label="空方族群" value={bearRows.length} total={industryRows.length} color="#3dae7c" />
        <SummaryStat label="加速轉強" value={accelerating} color="#ffc4b8" />
        <SummaryStat label="強勢群聚" value={strongCluster} color="#ff9783" />
        <SummaryStat label="短線過熱" value={overheated} color="#e6c26a" />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-3.5">
        <FilterChip label={`多方 ${bullRows.length}`} active={tab === "bull"} onClick={() => selectTab("bull")} />
        <FilterChip label={`空方 ${bearRows.length}`} active={tab === "bear"} onClick={() => selectTab("bear")} />
        <FilterChip label={`細產業 ${subIndustryRows.length}`} active={tab === "sub"} onClick={() => selectTab("sub")} />
      </div>

      {tab === "sub" && (
        <p className="px-3 pb-2.5 text-[10px] leading-[1.6] text-[var(--rd-text-muted)] sm:px-3.5">
          細產業以相同公式計算，但成分股較少（部分僅 1–2 檔），漲跌家數與突破家數等廣度分項因此更容易走極端、排名波動也較大 — 請對照「漲跌家數」欄的實際檔數解讀。
        </p>
      )}

      {/* ---------------- phone / tablet: one card per row ---------------- */}
      <div className="lg:hidden">
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 sm:px-3.5">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">排序</span>
          {(["score", "return", "rank", "rs"] as SortKey[]).map((k) => (
            <FilterChip key={k} label={SORT_LABEL[k]} active={sort.key === k} onClick={() => toggleSort(k)} />
          ))}
        </div>
        {sorted.length ? (
          <PanelRows style={{ borderTop: "1px solid var(--rd-line)" }}>
            {sorted.map((r) => (
              <MomentumCard key={r.key} row={r} watched={watched} />
            ))}
          </PanelRows>
        ) : (
          <p className="px-3 py-8 text-center text-[12px] text-[var(--rd-text-secondary)]">{emptyNote}</p>
        )}
      </div>

      {/* ---------------- desktop: the full 10-column table ---------------- */}
      <div className="hidden lg:block">
        <div className="rd-scroll-x scrollbar-thin">
          <div style={{ minWidth: 980 }}>
            <div
              className="grid items-center px-3.5 py-2.5 pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)] sm:px-3.5"
              style={{ gridTemplateColumns: COLUMNS, columnGap: 6, borderTop: "1px solid var(--rd-line)", borderBottom: "1px solid var(--rd-rule)" }}
            >
              <span />
              <span>{tab === "sub" ? "細產業" : "產業"}</span>
              <SortHeader label={SORT_LABEL.return} sortKey="return" sort={sort} onSort={toggleSort} align="right" />
              <SortHeader label={SORT_LABEL.score} sortKey="score" sort={sort} onSort={toggleSort} />
              <SortHeader label={SORT_LABEL.breadth} sortKey="breadth" sort={sort} onSort={toggleSort} />
              <SortHeader label={SORT_LABEL.volume} sortKey="volume" sort={sort} onSort={toggleSort} align="right" />
              <SortHeader label={SORT_LABEL.flow} sortKey="flow" sort={sort} onSort={toggleSort} />
              <SortHeader label={SORT_LABEL.rs} sortKey="rs" sort={sort} onSort={toggleSort} align="right" />
              <SortHeader label={SORT_LABEL.rank} sortKey="rank" sort={sort} onSort={toggleSort} />
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
                  className={cn("rd-hairline grid items-center px-3.5 py-2", highlighted && "rd-hot")}
                  style={{ gridTemplateColumns: COLUMNS, columnGap: 6 }}
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

            {sorted.length === 0 && <p className="py-8 text-center text-[12px] text-[var(--rd-text-secondary)]">{emptyNote}</p>}
          </div>
        </div>
        <p className="px-3.5 py-2 text-[10px] text-[var(--rd-text-muted)]">點欄位標題排序 · 紅漲綠跌 · 點列開產業雷達</p>
      </div>
    </Panel>
  );
}

/**
 * One momentum row as a card. Carries the same readings as the table row, but
 * stacked into three lines that each fit a phone: identity, the score with its
 * bar, then the breadth/volume/flow supporting figures.
 */
function MomentumCard({ row: r, watched }: { row: MomentumTableRow; watched: Set<string> }) {
  const badge = SENTIMENT_STATUS_BADGE[r.status];
  const vol = volumeWord(r.volumeRatio);
  const inst = institutionWord(r.foreignNet, r.trustNet, r.dealerNet);
  const flowNote = FLOW_SOURCE_NOTE[r.flowSource] ?? null;
  const trend = sentimentTrendGlyph(r.scoreDelta);
  const highlighted = r.rankDelta >= 4 || r.status === "accelerating";

  return (
    <ClickableRow
      href={r.href}
      className={cn("flex flex-col gap-2 px-3 py-3 sm:px-3.5", highlighted && "rd-hot")}
    >
      <div className="flex min-w-0 items-center gap-2">
        {r.industryId && <WatchStar itemType="industry" targetId={r.industryId} initialActive={watched.has(r.industryId)} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-bold">{r.label}</span>
          {r.sublabel && <span className="block truncate text-[9.5px] font-medium text-[var(--rd-text-muted)]">{r.sublabel}</span>}
        </span>
        <span className="shrink-0">
          <StatusChip badge={badge} compact />
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HeatBar score={r.sentimentScore} color={sentimentBarColor(r.sentimentScore, r.status)} grow />
          <span className="tnum shrink-0 text-[15px] font-bold" style={{ color: sentimentTextColor(r.sentimentScore) }}>
            {r.sentimentScore.toFixed(0)}
          </span>
          <span className="tnum shrink-0 text-[10.5px] font-semibold" style={{ color: trend.color }}>
            {trend.glyph}
            {r.scoreDelta !== 0 && Math.abs(r.scoreDelta).toFixed(0)}
          </span>
        </span>
        <span className="tnum shrink-0 text-[13px] font-bold" style={{ color: directionColor(r.averageReturnPct) }}>
          {pct(r.averageReturnPct)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <CardCell label="漲跌家數">
          <span className="flex items-center gap-1.5">
            <BreadthBar advancing={r.advancingCount} flat={r.flatCount} declining={r.decliningCount} width={34} />
            <BreadthCounts advancing={r.advancingCount} flat={r.flatCount} declining={r.decliningCount} />
          </span>
        </CardCell>
        <CardCell label="排名變化">
          <RankChange rank={r.rank} previousRank={r.previousRank} delta={r.rankDelta} compact />
        </CardCell>
        <CardCell label="量能">
          <span className="text-[11.5px] font-semibold" style={{ color: vol.color }}>
            {vol.label}
          </span>
        </CardCell>
        <CardCell label="相對強度">
          <span className="tnum text-[11.5px] font-semibold" style={{ color: directionColor(r.relativeStrengthPct) }}>
            {pct(r.relativeStrengthPct, 1)}
          </span>
        </CardCell>
        <CardCell label="法人">
          <span className="flex min-w-0 items-baseline gap-1 text-[11.5px] font-medium" style={{ color: inst.color }}>
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
        </CardCell>
        <CardCell label="突破">
          <span className="tnum text-[11.5px] font-semibold" style={{ color: r.breakoutCount > 0 ? "#ff8a70" : "var(--rd-text-secondary)" }}>
            {r.breakoutCount} / {r.stockCount}
          </span>
        </CardCell>
      </div>
    </ClickableRow>
  );
}

function CardCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-baseline justify-between gap-1.5 pb-1" style={{ borderBottom: "1px solid var(--rd-line)" }}>
      <span className="shrink-0 text-[9.5px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      {children}
    </span>
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
