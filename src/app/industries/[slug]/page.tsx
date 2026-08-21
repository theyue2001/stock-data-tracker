import { notFound } from "next/navigation";
import Link from "next/link";
import { getIndustryDetail, getWatchlistKeys } from "@/lib/queries";
import { num, pct } from "@/lib/format";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { SectionHeader } from "@/components/radar/section-header";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { RdSparkline } from "@/components/radar/rd-sparkline";
import {
  CYCLE_ZH,
  INDUSTRY_STATUS_BADGE,
  RISK_LABEL,
  STOCK_STATUS_BADGE,
  directionColor,
  displayRs,
  indicatorDirection,
  trendFromDelta,
} from "@/lib/radar-ui";
import type { IndustryStatus, StockStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function IndustryDetailPage({ params }: PageProps<"/industries/[slug]">) {
  const { slug } = await params;
  const [industry, watchKeys] = await Promise.all([getIndustryDetail(slug), getWatchlistKeys()]);

  if (!industry) notFound();

  const status = industry.status as IndustryStatus;
  const badge = INDUSTRY_STATUS_BADGE[status];
  const trend = trendFromDelta(industry.scoreToday - industry.scoreWeekAgo);
  const risk = RISK_LABEL[industry.riskLevel] ?? RISK_LABEL.medium;

  // Real market-mainstream label derived from the same component scores that
  // drive the heat score — not authored copy.
  const mainstream =
    industry.components.capitalFlow >= 65 && industry.scoreToday >= 65
      ? "市場主流"
      : industry.components.capitalFlow >= 50
        ? "次主流"
        : "非主流";

  const flowIntensity = industry.components.capitalFlow >= 70 ? "強勁流入" : industry.components.capitalFlow >= 55 ? "中等流入" : industry.components.capitalFlow >= 45 ? "中性" : "流出";
  const flowColor = industry.components.capitalFlow >= 55 ? "#ff8a70" : industry.components.capitalFlow >= 45 ? "rgba(243,242,242,.55)" : "#6cc79d";

  return (
    <div className="px-6 pb-6">
      <div className="pt-3.5">
        <Link href="/industries" className="text-[11px] font-medium text-[rgba(243,242,242,.55)] hover:text-[#ff8a70]">
          ← 產業雷達
        </Link>
      </div>
      <div className="flex items-center gap-3 py-3.5">
        <h1 className="text-[22px] font-black">{industry.nameZh ?? industry.name}</h1>
        <StatusChip badge={badge} />
        <WatchStar itemType="industry" targetId={industry.id} initialActive={watchKeys.industryIds.has(industry.id)} size={15} />
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">HEAT RANK · {industry.name}</span>
      </div>

      <KpiStrip
        cells={[
          {
            label: "熱度分數",
            value: (
              <>
                {industry.scoreToday.toFixed(0)} <span className="font-mono text-[11px] font-semibold" style={{ color: directionColor(industry.scoreToday - industry.scoreWeekAgo) }}>{trendFromDelta(industry.scoreToday - industry.scoreWeekAgo).glyph}</span>
              </>
            ),
          },
          { label: "趨勢", value: trend.glyph, valueColor: trend.color },
          { label: "主流狀態", value: mainstream },
          { label: "資金流強度", value: flowIntensity, valueColor: flowColor },
          { label: "循環位置", value: CYCLE_ZH[industry.cyclePosition] ?? industry.cyclePosition },
          { label: "風險等級", value: risk.label, valueColor: risk.color },
        ]}
      />

      <div className="grid gap-6 pt-[18px]" style={{ gridTemplateColumns: "1fr 320px" }}>
        {/* -------------------------- left -------------------------- */}
        <div>
          <SectionHeader title="產業論點" kicker="THESIS" />
          <p className="py-2 text-[13px] leading-[1.9]" style={{ maxWidth: 640, color: "rgba(243,242,242,.85)" }}>
            {industry.thesis ?? "此產業之論點建置中。"}
          </p>

          <SectionHeader title="領先指標" kicker="LEADING SIGNALS" />
          {industry.indicators.length === 0 ? (
            <p className="py-2.5 text-[11.5px] text-[var(--rd-text-secondary)]">此產業之領先指標序列建置中 — 先以熱度、資金流與催化事件判讀。</p>
          ) : (
            <div className="grid gap-3 pt-2.5" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              {industry.indicators.map((ind) => {
                const improving = ind.pctChange == null ? null : (ind.higherIsBetter ? ind.pctChange : -ind.pctChange) > 0 ? true : ind.pctChange === 0 ? null : false;
                const dbadge = indicatorDirection(improving);
                const color = improving === true ? "#ff5a3d" : improving === false ? "#3dae7c" : "rgba(243,242,242,.55)";
                return (
                  <div key={ind.id} className="p-3.5" style={{ background: "var(--rd-panel)", border: "1px solid var(--rd-line)" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-bold">{ind.name}</span>
                      <span className="ml-auto">
                        <StatusChip badge={dbadge} compact />
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="tnum text-[19px] font-extrabold">{num(ind.value, Math.abs(ind.value ?? 0) < 20 ? 2 : 1)}</span>
                      <span className="text-[10px] font-medium text-[var(--rd-text-secondary)]">{ind.unit}</span>
                      <span className="tnum text-[12px] font-bold" style={{ color }}>
                        {pct(ind.pctChange, 1)}
                      </span>
                    </div>
                    <RdSparkline points={ind.history.map((h) => h.value)} color={color} height={52} />
                    <div className="mt-1.5 flex font-mono text-[9px] text-[rgba(243,242,242,.38)]">
                      <span>{ind.sourceName ?? "—"}</span>
                      <span className="ml-auto">{ind.date ?? "—"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* -------------------------- right rail -------------------------- */}
        <div className="flex flex-col gap-4">
          <div>
            <SectionHeader title="相關個股" kicker="STOCKS" />
            {industry.stocks.length === 0 ? (
              <p className="py-2.5 text-[11.5px] text-[var(--rd-text-secondary)]">尚未收錄此產業個股。</p>
            ) : (
              industry.stocks.map((s, i) => {
                const sbadge = STOCK_STATUS_BADGE[s.status as StockStatus] ?? STOCK_STATUS_BADGE.high_level_consolidation;
                const rs = displayRs(s.relativeStrength ?? 100);
                return (
                  <div key={s.id} className="py-2" style={i < industry.stocks.length - 1 ? { borderBottom: "1px solid var(--rd-line)" } : undefined}>
                    <div className="flex items-center gap-[7px]">
                      <WatchStar itemType="stock" targetId={s.id} initialActive={watchKeys.stockIds.has(s.id)} size={12} />
                      <span className="text-[12.5px] font-bold">{s.nameZh ?? s.name}</span>
                      <span className="font-mono text-[10px] text-[var(--rd-text-muted)]">{s.ticker}</span>
                      <span className="ml-auto">
                        <StatusChip badge={sbadge} compact />
                      </span>
                    </div>
                    <div className="tnum mt-1 flex gap-3 pl-[19px] text-[11px] font-semibold">
                      <span>{num(s.price, 2)}</span>
                      <span style={{ color: directionColor(s.changePct) }}>{pct(s.changePct, 1)}</span>
                      <span style={{ color: rs >= 85 ? "#ff5a3d" : rs <= 45 ? "#6cc79d" : "#f3f2f2" }}>RS {rs}</span>
                      <span className="text-[10px] font-medium" style={{ color: s.foreignNet >= 0 ? "#ff8a70" : "#6cc79d" }}>
                        外資 {(s.foreignNet / 100_000).toFixed(1)}億
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div>
            <SectionHeader title="催化與風險" kicker="EVENTS" />
            <div className="flex gap-2 py-2" style={{ borderBottom: "1px solid var(--rd-line)" }}>
              <span className="shrink-0 pt-0.5 text-[9.5px] font-medium" style={{ color: "#ff8a70" }}>
                催化
              </span>
              <span className="text-[12px] leading-[1.6]">{industry.catalysts[0]?.title ?? "目前無重大催化事件。"}</span>
            </div>
            <div className="flex gap-2 py-2">
              <span className="shrink-0 pt-0.5 text-[9.5px] font-medium" style={{ color: "#e6c26a" }}>
                風險
              </span>
              <span className="text-[12px] leading-[1.6] text-[rgba(243,242,242,.75)]">{industry.primaryRisk ?? "尚無主要風險摘要。"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
