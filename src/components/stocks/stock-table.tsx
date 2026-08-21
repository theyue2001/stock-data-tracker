"use client";

import { useMemo, useState } from "react";
import { FilterChip } from "@/components/radar/filter-chip";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { ClickableRow } from "@/components/radar/clickable-row";
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

  return (
    <div className="px-6 pb-6">
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px]">
        <h1 className="text-[22px] font-black">個股雷達</h1>
        <span className="text-[11px] font-medium text-[var(--rd-text-secondary)]">基本面體質 與 短線強度 分離判讀 · 不做買賣建議</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">{visible.length} STOCKS</span>
      </div>

      <div className="rd-rule flex flex-wrap items-center gap-2 py-3">
        {industries.map((name) => (
          <FilterChip key={name} label={name} active={industry === name} onClick={() => setIndustry(name)} />
        ))}
        <span className="ml-auto">
          <FilterChip label="★ 僅看追蹤" active={watchOnly} onClick={() => setWatchOnly((v) => !v)} />
        </span>
      </div>

      <div className="scrollbar-thin overflow-x-auto">
        <div style={{ minWidth: 1180 }}>
          <div className="rd-rule grid pt-2 text-[9.5px] font-medium text-[var(--rd-text-muted)]" style={{ gridTemplateColumns: GRID, columnGap: 8 }}>
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
            <span>EPS</span>
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
                <WatchStar
                  itemType="stock"
                  targetId={s.id}
                  initialActive={watched.has(s.id)}
                  onChange={(active) =>
                    setWatched((prev) => {
                      const next = new Set(prev);
                      if (active) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
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
        </div>
      </div>

      <div className="flex gap-4 pt-2.5 text-[10px] text-[var(--rd-text-muted)]">
        <span>RS＝相對大盤強度（0–100）</span>
        <span>位階＝股價所處區間位置</span>
        <span>點欄位「漲跌」「RS」可排序</span>
      </div>

      {visible.length === 0 && <p className="py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">沒有符合篩選條件的個股。</p>}
    </div>
  );
}
