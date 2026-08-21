"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FilterChip } from "@/components/radar/filter-chip";
import { StatusChip } from "@/components/radar/status-chip";
import { RdSparkline } from "@/components/radar/rd-sparkline";
import { indicatorDirection } from "@/lib/radar-ui";
import { num, pct } from "@/lib/format";
import type { getIndicatorOverview } from "@/lib/queries";

type Row = Awaited<ReturnType<typeof getIndicatorOverview>>[number];

export function IndicatorExplorer({ rows }: { rows: Row[] }) {
  const [group, setGroup] = useState("全部");

  // Indicators are 1:1 with an industry in this schema (no separate
  // cross-industry grouping table), so "group" = industry name — a real
  // substitute for the handoff's illustrative `grp` field.
  const groups = useMemo(() => ["全部", ...Array.from(new Set(rows.map((r) => r.industryName)))], [rows]);
  const visible = group === "全部" ? rows : rows.filter((r) => r.industryName === group);

  return (
    <div className="px-6 pb-6">
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px]">
        <h1 className="text-[22px] font-black">領先指標</h1>
        <span className="text-[11px] font-medium text-[var(--rd-text-secondary)]">在股價反應前，先看見產業數據的轉折</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">12M TREND</span>
      </div>

      <div className="rd-rule flex flex-wrap items-center gap-2 py-3">
        {groups.map((g) => (
          <FilterChip key={g} label={g} active={group === g} onClick={() => setGroup(g)} />
        ))}
        <span className="ml-auto text-[10px] font-medium text-[var(--rd-text-muted)]">紅＝改善 · 綠＝惡化/壓力 · 灰＝持平</span>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {visible.map((ind) => {
          const improving = ind.pctChange == null ? null : (ind.higherIsBetter ? ind.pctChange : -ind.pctChange) > 0 ? true : ind.pctChange === 0 ? null : false;
          const badge = indicatorDirection(improving);
          const color = improving === true ? "#ff5a3d" : improving === false ? "#3dae7c" : "rgba(243,242,242,.55)";

          return (
            <Link
              key={ind.id}
              href={`/industries/${ind.industrySlug}`}
              className="block p-4"
              style={{ background: "var(--rd-panel)", border: "1px solid var(--rd-line)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold">{ind.name}</span>
                <span className="font-mono text-[9px] text-[var(--rd-text-muted)]">{ind.industryName}</span>
                <span className="ml-auto">
                  <StatusChip badge={badge} />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tnum text-[22px] font-extrabold">{num(ind.value, Math.abs(ind.value ?? 0) < 20 ? 2 : 1)}</span>
                <span className="text-[10.5px] font-medium text-[var(--rd-text-secondary)]">{ind.unit}</span>
                <span className="tnum text-[12.5px] font-bold" style={{ color }}>
                  {pct(ind.pctChange, 1)}
                </span>
              </div>
              <RdSparkline points={ind.history.map((h) => h.value)} color={color} />
              <div className="mt-2 flex font-mono text-[9.5px] text-[rgba(243,242,242,.38)]">
                <span>{ind.sourceName ?? "—"}</span>
                <span className="ml-auto">{ind.date ?? "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 && <p className="py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">此分類尚無指標。</p>}
    </div>
  );
}
