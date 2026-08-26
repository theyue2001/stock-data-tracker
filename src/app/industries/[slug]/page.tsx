import { notFound } from "next/navigation";
import { getIndustryDetail, getIndustrySlugs, getWatchlistKeys } from "@/lib/queries";
import { getIndustrySentimentPanel } from "@/lib/sentiment-queries";
import { num, pct } from "@/lib/format";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { PageHeader, PageShell } from "@/components/layout/page";
import { Panel, PanelRows } from "@/components/radar/panel";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { RdSparkline } from "@/components/radar/rd-sparkline";
import { SentimentPanel } from "@/components/sentiment/sentiment-panel";
import {
  CYCLE_ZH,
  INDUSTRY_STATUS_BADGE,
  LOW_CONFIDENCE_BADGE,
  RISK_LABEL,
  STOCK_STATUS_BADGE,
  directionColor,
  displayRs,
  flowWord,
  indicatorDirection,
  trendFromDelta,
} from "@/lib/radar-ui";
import type { IndustryStatus, StockStatus } from "@/lib/types";

export async function generateStaticParams() {
  return (await getIndustrySlugs()).map((slug) => ({ slug }));
}

export default async function IndustryDetailPage({ params }: PageProps<"/industries/[slug]">) {
  const { slug } = await params;
  const [industry, watchKeys, sentiment] = await Promise.all([
    getIndustryDetail(slug),
    getWatchlistKeys(),
    getIndustrySentimentPanel(slug),
  ]);

  if (!industry) notFound();

  const status = industry.status as IndustryStatus;
  const badge = INDUSTRY_STATUS_BADGE[status];
  const trend = trendFromDelta(industry.scoreToday - industry.scoreWeekAgo);
  const risk = RISK_LABEL[industry.riskLevel] ?? RISK_LABEL.medium;

  // Real market-mainstream label derived from the same component scores that
  // drive the heat score — not authored copy.
  //
  // Both labels are a statement ABOUT capital flow, so with no flow print for
  // the session there is nothing to state. Neither may fall back to a number:
  // 非主流 and 流出 are both bearish readings, and the absence of a T86 report
  // is not evidence of either.
  const capitalFlow = industry.components.capitalFlow;
  const mainstream =
    capitalFlow === null
      ? "無資料"
      : capitalFlow >= 65 && industry.scoreToday >= 65
        ? "市場主流"
        : capitalFlow >= 50
          ? "次主流"
          : "非主流";

  const flow = flowWord(capitalFlow);

  return (
    <PageShell>
      <PageHeader
        title={industry.nameZh ?? industry.name}
        note={industry.name}
        backHref="/industries"
        backLabel="產業雷達"
      >
        <StatusChip badge={badge} />
        {industry.lowConfidence ? <StatusChip badge={LOW_CONFIDENCE_BADGE} /> : null}
        <WatchStar itemType="industry" targetId={industry.id} initialActive={watchKeys.industryIds.has(industry.id)} size={15} />
      </PageHeader>

      <KpiStrip
        cells={[
          {
            label: "中期熱度分數",
            emphasis: true,
            value: (
              <>
                {industry.scoreToday.toFixed(0)} <span className="font-mono text-[11px] font-semibold" style={{ color: directionColor(industry.scoreToday - industry.scoreWeekAgo) }}>{trendFromDelta(industry.scoreToday - industry.scoreWeekAgo).glyph}</span>
              </>
            ),
          },
          { label: "趨勢", value: trend.glyph, valueColor: trend.color },
          { label: "主流狀態", value: mainstream },
          { label: "資金流強度", value: flow.label, valueColor: flow.color },
          { label: "循環位置", value: CYCLE_ZH[industry.cyclePosition] ?? industry.cyclePosition },
          { label: "風險等級", value: risk.label, valueColor: risk.color },
        ]}
      />

      {/* 短線氣氛 sits above the medium-term content and inside its own box:
          spec §8 requires it to be visually separate from the Industry Heat
          Score so a reader never mistakes one horizon's number for the
          other's. */}
      <div className="mt-3 sm:mt-4">
        {sentiment ? (
          <SentimentPanel panel={sentiment} />
        ) : (
          <Panel title="短線氣氛" kicker="SHORT-TERM SENTIMENT">
            <p className="text-[11.5px] leading-[1.7] text-[var(--rd-text-secondary)]">
              尚無氣氛值資料 — 執行 <code>npm run jobs:refresh</code> 產生今日快照。
            </p>
          </Panel>
        )}
      </div>

      <div className="mt-3 grid min-w-0 gap-3 sm:mt-4 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* -------------------------- left -------------------------- */}
        <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
          <Panel title="產業論點" kicker="THESIS" note={`中期產業熱度 ${industry.scoreToday.toFixed(0)}`}>
            <p className="text-[13px] leading-[1.9]" style={{ maxWidth: 640, color: "rgba(243,242,242,.85)" }}>
              {industry.thesis ?? "此產業之論點建置中。"}
            </p>
          </Panel>

          <Panel title="領先指標" kicker="LEADING SIGNALS" note={`${industry.indicators.length} 項`}>
          {industry.indicators.length === 0 ? (
            <p className="text-[11.5px] text-[var(--rd-text-secondary)]">此產業之領先指標序列建置中 — 先以熱度、資金流與催化事件判讀。</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {industry.indicators.map((ind) => {
                const hasData = ind.value != null;
                const improving = ind.pctChange == null ? null : (ind.higherIsBetter ? ind.pctChange : -ind.pctChange) > 0 ? true : ind.pctChange === 0 ? null : false;
                const dbadge = indicatorDirection(improving, hasData);
                const color = improving === true ? "#ff5a3d" : improving === false ? "#3dae7c" : "rgba(243,242,242,.55)";
                return (
                  <div key={ind.id} className="rd-card p-3 sm:p-3.5" style={{ background: "var(--rd-card-hover)" }}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 text-[12.5px] font-bold">{ind.name}</span>
                      <span className="shrink-0">
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
          </Panel>
        </div>

        {/* -------------------------- right rail -------------------------- */}
        <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
          <Panel title="相關個股" kicker="STOCKS" note={`${industry.stocks.length} 檔`} flush>
            {industry.stocks.length === 0 ? (
              <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚未收錄此產業個股。</p>
            ) : (
              <PanelRows>
                {industry.stocks.map((s) => {
                  const sbadge = STOCK_STATUS_BADGE[s.status as StockStatus] ?? STOCK_STATUS_BADGE.high_level_consolidation;
                  const rs = displayRs(s.relativeStrength ?? 100);
                  return (
                    <div key={s.id} className="px-3 py-2.5 sm:px-3.5">
                      <div className="flex min-w-0 items-center gap-[7px]">
                        <WatchStar itemType="stock" targetId={s.id} initialActive={watchKeys.stockIds.has(s.id)} size={12} />
                        <span className="truncate text-[12.5px] font-bold">{s.nameZh ?? s.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--rd-text-muted)]">{s.ticker}</span>
                        <span className="ml-auto shrink-0">
                          <StatusChip badge={sbadge} compact />
                        </span>
                      </div>
                      <div className="tnum mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[19px] text-[11px] font-semibold">
                        <span>{num(s.price, 2)}</span>
                        <span style={{ color: directionColor(s.changePct) }}>{pct(s.changePct, 1)}</span>
                        <span style={{ color: rs >= 85 ? "#ff5a3d" : rs <= 45 ? "#6cc79d" : "#f3f2f2" }}>RS {rs}</span>
                        <span className="text-[10px] font-medium" style={{ color: s.foreignNet >= 0 ? "#ff8a70" : "#6cc79d" }}>
                          外資 {(s.foreignNet / 100_000).toFixed(1)}億
                        </span>
                      </div>
                    </div>
                  );
                })}
              </PanelRows>
            )}
          </Panel>

          <Panel title="催化與風險" kicker="EVENTS" flush>
            <div className="flex gap-2 px-3 py-2.5 sm:px-3.5" style={{ borderBottom: "1px solid var(--rd-line)" }}>
              <span className="shrink-0 pt-0.5 text-[9.5px] font-medium" style={{ color: "#ff8a70" }}>
                催化
              </span>
              <span className="text-[12px] leading-[1.6]">{industry.catalysts[0]?.title ?? "目前無重大催化事件。"}</span>
            </div>
            <div className="flex gap-2 px-3 py-2.5 sm:px-3.5">
              <span className="shrink-0 pt-0.5 text-[9.5px] font-medium" style={{ color: "#e6c26a" }}>
                風險
              </span>
              <span className="text-[12px] leading-[1.6] text-[rgba(243,242,242,.75)]">{industry.primaryRisk ?? "尚無主要風險摘要。"}</span>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
