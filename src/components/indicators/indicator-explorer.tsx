"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FilterChip } from "@/components/radar/filter-chip";
import { PageHeader, PageShell } from "@/components/layout/page";
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
    <PageShell>
      <PageHeader title="領先指標" note="12M TREND" subtitle="在股價反應前，先看見產業數據的轉折" />

      <div className="rd-card rd-card-body mb-3 flex flex-col gap-2.5 sm:mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">產業</span>
          {groups.map((g) => (
            <FilterChip key={g} label={g} active={group === g} onClick={() => setGroup(g)} />
          ))}
        </div>
        <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">紅＝改善 · 綠＝惡化/壓力 · 灰＝持平</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-3.5 xl:grid-cols-3">
        {visible.map((ind) => {
          const hasData = ind.value != null;
          const improving = ind.pctChange == null ? null : (ind.higherIsBetter ? ind.pctChange : -ind.pctChange) > 0 ? true : ind.pctChange === 0 ? null : false;
          const badge = indicatorDirection(improving, hasData);
          const color = improving === true ? "#ff5a3d" : improving === false ? "#3dae7c" : "rgba(243,242,242,.55)";

          return (
            <Link
              key={ind.id}
              href={`/industries/${ind.industrySlug}`}
              className="rd-card rd-card-tap block p-3.5 text-[var(--rd-text)] sm:p-4"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 text-[13px] font-bold">{ind.name}</span>
                <span className="shrink-0">
                  <StatusChip badge={badge} />
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[9px] text-[var(--rd-text-muted)]">{ind.industryName}</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tnum text-[22px] font-extrabold">{num(ind.value, Math.abs(ind.value ?? 0) < 20 ? 2 : 1)}</span>
                <span className="text-[10.5px] font-medium text-[var(--rd-text-secondary)]">{ind.unit}</span>
                <span className="tnum text-[12.5px] font-bold" style={{ color }}>
                  {pct(ind.pctChange, 1)}
                </span>
              </div>
              <RdSparkline points={ind.history.map((h) => h.value)} color={color} />
              {ind.relatedStocks.length > 0 && (
                <div
                  className="mt-1.5 truncate text-[9.5px] text-[var(--rd-text-muted)]"
                  title={ind.relatedStocks.map((s) => `${s.ticker} ${s.name}`).join("、")}
                >
                  相關個股 <span className="font-mono">{ind.relatedStocks.map((s) => s.ticker).join(" · ")}</span>
                </div>
              )}
              <div className="mt-2 flex font-mono text-[9.5px] text-[rgba(243,242,242,.38)]">
                <span>{ind.sourceName ?? "—"}</span>
                <span className="ml-auto">{ind.date ?? "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 && <p className="py-10 text-center text-[12px] text-[var(--rd-text-secondary)]">此分類尚無指標。</p>}
    </PageShell>
  );
}
