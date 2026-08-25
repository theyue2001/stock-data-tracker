"use client";

import { useMemo, useState } from "react";
import { FilterChip } from "@/components/radar/filter-chip";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { ClickableRow } from "@/components/radar/clickable-row";
import { PageHeader, PageShell, ScrollHint } from "@/components/layout/page";
import { Panel, PanelRows } from "@/components/radar/panel";
import {
  STOCK_STATUS_BADGE,
  directionColor,
  displayRs,
  revenueAccelWord,
  technicalTrendWord,
  valuationPositionWord,
} from "@/lib/radar-ui";
import { num, pct } from "@/lib/format";
import type { StockRadarRow } from "@/lib/queries";
import type { StockStatus } from "@/lib/types";

// Thirteen columns of it. The grid is the right shape on a desktop — the
// 市場・籌碼 / 基本面體質 / 短線強度 / 訊號 groupings only read as groupings when
// the columns line up — but it cannot reflow, so below `lg` each stock becomes
// its own card carrying the same readings in three lines.
const GRID = "26px 150px 64px 60px 62px 96px 80px 56px 44px 56px 56px minmax(140px,1fr) 92px";
type SortKey = "chg" | "rs";

export function StockTable({ rows, watchedIds }: { rows: StockRadarRow[]; watchedIds: Set<string> }) {
  const [industry, setIndustry] = useState("全部");
  const [watchOnly, setWatchOnly] = useState(false);
  const [watched, setWatched] = useState(watchedIds);
  const [sortKey, setSortKey] = useState<SortKey>("chg");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  const industries = useMemo(() => ["全部", ...Array.from(new Set(rows.map((r) => r.industryName))).sort()], [rows]);

  const visible = useMemo(() => {
    let subset = rows.filter((r) => (industry === "全部" || r.industryName === industry) && (!watchOnly || watched.has(r.id)));
    subset = [...subset].sort((a, b) => (sortKey === "chg" ? a.changePct - b.changePct : (a.relativeStrength ?? 0) - (b.relativeStrength ?? 0)) * sortDir);
    return subset;
  }, [rows, industry, watchOnly, watched, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === -1 ? 1 : -1) as -1 | 1);
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const sortGlyph = (key: SortKey) => (sortKey === key ? (sortDir === -1 ? "▼" : "▲") : "");

  const onStarChange = (id: string) => (active: boolean) =>
    setWatched((prev) => {
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <PageShell>
      <PageHeader
        title="個股雷達"
        note={`${visible.length} STOCKS`}
        subtitle="基本面體質 與 短線強度 分離判讀 · 不做買賣建議"
      />

      <div className="rd-card rd-card-body mb-3 flex flex-col gap-2.5 sm:mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">產業</span>
          {industries.map((name) => (
            <FilterChip key={name} label={name} active={industry === name} onClick={() => setIndustry(name)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">排序</span>
          <FilterChip label={`漲跌 ${sortGlyph("chg")}`} active={sortKey === "chg"} onClick={() => toggleSort("chg")} />
          <FilterChip label={`RS ${sortGlyph("rs")}`} active={sortKey === "rs"} onClick={() => toggleSort("rs")} />
          <span className="ml-auto">
            <FilterChip label="★ 僅看追蹤" active={watchOnly} onClick={() => setWatchOnly((v) => !v)} />
          </span>
        </div>
      </div>

      <Panel title="個股清單" kicker="STOCK LIST" note="RS＝相對大盤強度 0–100 · 位階＝股價所處區間位置" flush>
        {/* ---------------- phone / tablet: one card per stock ---------------- */}
        <div className="lg:hidden">
          {visible.length ? (
            <PanelRows>
              {visible.map((s) => (
                <StockCard key={s.id} row={s} watched={watched.has(s.id)} onStarChange={onStarChange(s.id)} />
              ))}
            </PanelRows>
          ) : (
            <p className="px-3 py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">沒有符合篩選條件的個股。</p>
          )}
        </div>

        {/* ---------------- desktop: the full column grid ---------------- */}
        <div className="hidden lg:block">
          <ScrollHint minWidth={1180}>
            <div className="grid pt-2 text-[9.5px] font-medium text-[var(--rd-text-muted)]" style={{ gridTemplateColumns: GRID, columnGap: 8 }}>
              <span style={{ gridColumn: "1 / 7" }}>市場・籌碼</span>
              <span style={{ gridColumn: "7 / 9", borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>基本面體質</span>
              <span style={{ gridColumn: "9 / 12", borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>短線強度</span>
              <span style={{ gridColumn: "12 / 14", borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>訊號</span>
            </div>
            <div
              className="grid items-end py-2 pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)]"
              style={{ gridTemplateColumns: GRID, columnGap: 8, borderBottom: "1px solid var(--rd-rule)" }}
            >
              <span />
              <span>個股</span>
              <span className="text-right">價格</span>
              <button type="button" onClick={() => toggleSort("chg")} className="cursor-pointer text-right font-medium" style={{ color: "#ff8a70" }}>
                漲跌 {sortGlyph("chg")}
              </button>
              <span className="text-right">量(張)</span>
              <span>法人動向</span>
              <span style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>營收動能</span>
              {/* t187ap14 files EPS cumulatively from January and resets at Q1, so the
                  stored figure is year-to-date, not one quarter. Labelled as such
                  rather than de-cumulated, because the feed does not carry the prior
                  cumulative to subtract — see src/lib/providers/live/fundamental-provider.ts. */}
              <span>EPS(累計)</span>
              <button
                type="button"
                onClick={() => toggleSort("rs")}
                className="cursor-pointer text-left font-medium"
                style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10, color: "#ff8a70" }}
              >
                RS {sortGlyph("rs")}
              </button>
              <span>技術</span>
              <span>位階</span>
              <span style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>催化</span>
              <span>狀態</span>
            </div>

            {visible.map((s) => {
              const badge = STOCK_STATUS_BADGE[s.status as StockStatus];
              const rev = revenueAccelWord(s.revenueMomChangePct);
              const tech = technicalTrendWord(s.technicalTrend);
              const pos = valuationPositionWord(s.valuationPosition);
              const rs = displayRs(s.relativeStrength ?? 100);
              const rsColor = rs >= 85 ? "#ff5a3d" : rs <= 45 ? "#6cc79d" : "#f3f2f2";

              return (
                <ClickableRow
                  key={s.id}
                  href={`/industries/${s.industrySlug}`}
                  className="rd-hairline grid items-center py-2"
                  style={{ gridTemplateColumns: GRID, columnGap: 8 }}
                >
                  <WatchStar itemType="stock" targetId={s.id} initialActive={watched.has(s.id)} onChange={onStarChange(s.id)} />
                  <span className="min-w-0">
                    <span className="text-[12.5px] font-bold">{s.nameZh ?? s.name}</span>{" "}
                    <span className="font-mono text-[10px] text-[var(--rd-text-muted)]">{s.ticker}</span>
                    <span className="block truncate text-[9.5px] text-[var(--rd-text-muted)]">{s.industryName}</span>
                  </span>
                  <span className="tnum text-right text-[12.5px] font-semibold">{num(s.price, 2)}</span>
                  <span className="tnum text-right text-[12px] font-bold" style={{ color: directionColor(s.changePct) }}>
                    {pct(s.changePct, 1)}
                  </span>
                  <span className="tnum text-right text-[11px] font-medium text-[rgba(243,242,242,.55)]">{Math.round(s.volume / 1000).toLocaleString()}</span>
                  <span className="min-w-0">
                    <span className="block text-[10.5px] font-medium" style={{ color: s.foreignNet >= 0 ? "#ff8a70" : "#6cc79d" }}>
                      外資 {(s.foreignNet / 100_000).toFixed(1)}億 {s.foreignStreak !== 0 && (s.foreignStreak > 0 ? `連${s.foreignStreak}買` : `連${-s.foreignStreak}賣`)}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium text-[rgba(243,242,242,.5)]">投信 {(s.trustNet / 100_000).toFixed(1)}億</span>
                  </span>
                  <span style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}>
                    <span className="tnum text-[11.5px] font-semibold">{pct(s.revenueYoy, 0)}</span>{" "}
                    <span className="text-[10px] font-medium" style={{ color: rev.color }}>
                      {rev.label}
                    </span>
                  </span>
                  <span className="tnum text-[11px] font-medium text-[rgba(243,242,242,.7)]">{num(s.eps, 2)}</span>
                  <span className="tnum text-[12px] font-semibold" style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10, color: rsColor }}>
                    {rs.toFixed(0)}
                  </span>
                  <span className="text-[11px] font-medium" style={{ color: tech.color }}>
                    {tech.label}
                  </span>
                  <span className="text-[11px] font-medium" style={{ color: pos.color }}>
                    {pos.label}
                  </span>
                  <span
                    className="truncate text-[11px] font-medium text-[rgba(243,242,242,.75)]"
                    style={{ borderLeft: "2px solid var(--rd-rule)", paddingLeft: 10 }}
                    title={s.mainCatalyst ?? undefined}
                  >
                    {s.mainCatalyst ?? "—"}
                  </span>
                  <StatusChip badge={badge} compact />
                </ClickableRow>
              );
            })}

            {visible.length === 0 && <p className="py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">沒有符合篩選條件的個股。</p>}
          </ScrollHint>
        </div>
      </Panel>
    </PageShell>
  );
}

/** One stock as a card: identity, price action, then the體質 / 強度 / 訊號
 *  readings the desktop grid separates by column group. */
function StockCard({ row: s, watched, onStarChange }: { row: StockRadarRow; watched: boolean; onStarChange: (active: boolean) => void }) {
  const badge = STOCK_STATUS_BADGE[s.status as StockStatus];
  const rev = revenueAccelWord(s.revenueMomChangePct);
  const tech = technicalTrendWord(s.technicalTrend);
  const pos = valuationPositionWord(s.valuationPosition);
  const rs = displayRs(s.relativeStrength ?? 100);
  const rsColor = rs >= 85 ? "#ff5a3d" : rs <= 45 ? "#6cc79d" : "#f3f2f2";

  return (
    <ClickableRow href={`/industries/${s.industrySlug}`} className="flex flex-col gap-2 px-3 py-3 sm:px-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <WatchStar itemType="stock" targetId={s.id} initialActive={watched} onChange={onStarChange} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13.5px] font-bold">{s.nameZh ?? s.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-[var(--rd-text-muted)]">{s.ticker}</span>
          </span>
          <span className="mt-0.5 block truncate text-[9.5px] text-[var(--rd-text-muted)]">{s.industryName}</span>
        </span>
        <span className="shrink-0">
          <StatusChip badge={badge} compact />
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tnum text-[15px] font-bold">{num(s.price, 2)}</span>
        <span className="tnum text-[13px] font-bold" style={{ color: directionColor(s.changePct) }}>
          {pct(s.changePct, 1)}
        </span>
        <span className="tnum text-[11px] font-semibold" style={{ color: rsColor }}>
          RS {rs.toFixed(0)}
        </span>
        <span className="tnum ml-auto text-[10.5px] font-medium text-[var(--rd-text-muted)]">
          量 {Math.round(s.volume / 1000).toLocaleString()} 張
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Cell label="外資">
          <span className="text-[11px] font-semibold" style={{ color: s.foreignNet >= 0 ? "#ff8a70" : "#6cc79d" }}>
            {(s.foreignNet / 100_000).toFixed(1)}億
            {s.foreignStreak !== 0 && ` ${s.foreignStreak > 0 ? `連${s.foreignStreak}買` : `連${-s.foreignStreak}賣`}`}
          </span>
        </Cell>
        <Cell label="投信">
          <span className="tnum text-[11px] font-semibold" style={{ color: s.trustNet >= 0 ? "#ff8a70" : "#6cc79d" }}>
            {(s.trustNet / 100_000).toFixed(1)}億
          </span>
        </Cell>
        <Cell label="營收動能">
          <span className="text-[11px] font-semibold" style={{ color: rev.color }}>
            <span className="tnum text-[var(--rd-text)]">{pct(s.revenueYoy, 0)}</span> {rev.label}
          </span>
        </Cell>
        <Cell label="EPS(累計)">
          <span className="tnum text-[11px] font-semibold">{num(s.eps, 2)}</span>
        </Cell>
        <Cell label="技術">
          <span className="text-[11px] font-semibold" style={{ color: tech.color }}>
            {tech.label}
          </span>
        </Cell>
        <Cell label="位階">
          <span className="text-[11px] font-semibold" style={{ color: pos.color }}>
            {pos.label}
          </span>
        </Cell>
      </div>

      {s.mainCatalyst && (
        <div className="flex gap-2">
          <span className="shrink-0 pt-px text-[9.5px] font-medium text-[var(--rd-text-muted)]">催化</span>
          <span className="text-[11px] leading-[1.5] font-medium text-[rgba(243,242,242,.75)]">{s.mainCatalyst}</span>
        </div>
      )}
    </ClickableRow>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-baseline justify-between gap-1.5 pb-1" style={{ borderBottom: "1px solid var(--rd-line)" }}>
      <span className="shrink-0 text-[9.5px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      {children}
    </span>
  );
}
