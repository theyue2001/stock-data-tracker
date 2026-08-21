import Link from "next/link";
import {
  getAlerts,
  getCapitalFlow,
  getIndicatorOverview,
  getIndustryRadar,
  getMarketStatus,
  getWatchlistKeys,
} from "@/lib/queries";
import { num, pct } from "@/lib/format";
import { SectionHeader } from "@/components/radar/section-header";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { HeatBar } from "@/components/radar/heat-bar";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { ClickableRow } from "@/components/radar/clickable-row";
import {
  INDUSTRY_STATUS_BADGE,
  directionColor,
  flowWord,
  heatBarColor,
  leadingIndicatorWord,
  trendFromDelta,
  yiFlow,
} from "@/lib/radar-ui";
import type { IndustryStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function yi0(raw: number): string {
  const v = Math.round(raw / 1e8);
  return v.toLocaleString("en-US");
}

/** Real-data-derived regime chip: direction from the index move, breadth
 *  from how many industries are strengthening vs. weakening today. Not
 *  copywriting — every input is a stored/derived number. */
function regimeLabel(changePct: number, radar: Awaited<ReturnType<typeof getIndustryRadar>>) {
  const accelerating = radar.filter((r) => r.status === "accelerating" || r.status === "strengthening").length;
  const weak = radar.filter((r) => r.status === "weakening").length;
  const p1 = changePct >= 0 ? "多頭延續" : "震盪修正";
  const p2 = accelerating > weak ? "類股輪動加速" : accelerating === weak ? "類股表現分歧" : "類股全面轉弱";
  return `${p1} · ${p2}`;
}

export default async function OverviewPage() {
  const [market, radar, flow, indicators, alerts, watchKeys] = await Promise.all([
    getMarketStatus(),
    getIndustryRadar(),
    getCapitalFlow(),
    getIndicatorOverview(),
    getAlerts(20),
    getWatchlistKeys(),
  ]);

  const byScoreToday = [...radar].sort((a, b) => b.scoreToday - a.scoreToday);
  const byScoreWeekAgo = [...radar].sort((a, b) => b.scoreWeekAgo - a.scoreWeekAgo);
  const rankToday = new Map(byScoreToday.map((r, i) => [r.id, i + 1]));
  const rankWeekAgo = new Map(byScoreWeekAgo.map((r, i) => [r.id, i + 1]));

  const top8 = byScoreToday.slice(0, 8);
  const weakest3 = [...byScoreToday].slice(-3).reverse();

  const overheated = radar.filter((r) => r.status === "overheated");
  const riskTemp = overheated.length ? { label: "偏熱", color: "#e6b23a" } : { label: "正常", color: "#f3f2f2" };

  const sortedFlow = [...flow.industries].sort((a, b) => b.foreignNet + b.trustNet - (a.foreignNet + a.trustNet));
  // Only genuinely positive/negative rows qualify — see identical note on
  // the Capital Flow page.
  const inflow3 = sortedFlow.filter((f) => f.foreignNet + f.trustNet > 0).slice(0, 3);
  const outflow3 = sortedFlow.filter((f) => f.foreignNet + f.trustNet < 0).slice(-3).reverse();

  const indicatorMovers = [...indicators]
    .filter((i) => i.pctChange != null)
    .sort((a, b) => Math.abs(b.pctChange!) - Math.abs(a.pctChange!))
    .slice(0, 4);

  const riskEvents = alerts.slice(0, 3);

  // 主題監測: derived from real data — high-importance catalysts on
  // accelerating/strengthening industries stand in for "具延續性" themes;
  // industries whose computed status is already "overheated" stand in for
  // "已過熱" themes. No invented theme copy.
  const continuingThemes = radar
    .filter((r) => (r.status === "accelerating" || r.status === "strengthening") && r.majorCatalyst)
    .slice(0, 3);

  return (
    <div className="px-6 pb-6">
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px]">
        <h1 className="text-[22px] font-black">市場總覽</h1>
        {market && (
          <span className="bg-[rgba(255,86,60,.14)] px-2.5 py-1 text-[11px] font-bold text-[#ff8a70]">
            {regimeLabel(market.changePct, radar)}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">LAST UPDATE 20:00 TST</span>
      </div>

      {market ? (
        <KpiStrip
          cells={[
            {
              label: "加權指數 TAIEX",
              value: num(market.close, 2),
              valueColor: directionColor(market.changePct),
              sub: (
                <span style={{ color: directionColor(market.changePct) }}>
                  {market.change >= 0 ? "▲" : "▼"} {num(Math.abs(market.change), 2)}（{pct(market.changePct)}）
                </span>
              ),
            },
            {
              label: "成交金額",
              value: (
                <>
                  {yi0(market.volume)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              sub: (
                <>
                  較 5 日均{" "}
                  <span style={{ color: directionColor(market.volumeVs5dAvgPct) }}>{pct(market.volumeVs5dAvgPct, 0)}</span>
                </>
              ),
            },
            {
              label: "外資",
              value: (
                <>
                  {yiFlow(market.foreignNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(market.foreignNet),
              sub: "法人買賣超（NT$ 千元換算）",
            },
            {
              label: "投信",
              value: (
                <>
                  {yiFlow(market.trustNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(market.trustNet),
              sub: "法人買賣超",
            },
            {
              label: "自營商",
              value: (
                <>
                  {yiFlow(market.dealerNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(market.dealerNet),
            },
            {
              label: "風險溫度",
              value: riskTemp.label,
              valueColor: riskTemp.color,
              sub: `過熱產業 ${overheated.length} 個`,
            },
          ]}
        />
      ) : (
        <p className="py-6 text-[12px] text-[var(--rd-text-secondary)]">
          尚無市場資料 — 執行 <code>npm run db:seed</code>。
        </p>
      )}

      <div className="grid gap-6 pt-[18px]" style={{ gridTemplateColumns: "1fr 336px" }}>
        {/* -------------------------- left: heat ranking -------------------------- */}
        <div>
          <div className="rd-rule flex items-baseline gap-2.5 pt-2.5">
            <span className="text-[13px] font-bold">產業熱度排行</span>
            <span className="font-mono text-[9px] tracking-[.16em] text-[var(--rd-text-muted)]">INDUSTRY HEAT RANKING</span>
            <span className="ml-auto text-[10px] text-[var(--rd-text-muted)]">☆ 加入追蹤 · 點列開產業雷達</span>
          </div>
          <div
            className="grid items-center py-2.5 pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)]"
            style={{ gridTemplateColumns: "26px 52px 1fr 148px 44px 92px 92px 100px", columnGap: 6, borderBottom: "1px solid var(--rd-rule)" }}
          >
            <span />
            <span>排名</span>
            <span>產業</span>
            <span>熱度</span>
            <span>趨勢</span>
            <span>資金流</span>
            <span>領先指標</span>
            <span>狀態</span>
          </div>
          {top8.map((r) => {
            const today = rankToday.get(r.id)!;
            const weekAgo = rankWeekAgo.get(r.id)!;
            const jump = weekAgo - today;
            const trend = trendFromDelta(r.scoreChange);
            const flow = flowWord(r.components.capitalFlow);
            const lead = leadingIndicatorWord(r.components.leadingIndicator);
            const badge = INDUSTRY_STATUS_BADGE[r.status as IndustryStatus];
            const highlighted = jump >= 4;

            return (
              <ClickableRow
                key={r.id}
                href={`/industries/${r.slug}`}
                className="rd-hairline grid items-center py-2"
                style={{ gridTemplateColumns: "26px 52px 1fr 148px 44px 92px 92px 100px", columnGap: 6, background: highlighted ? "rgba(255,86,60,.06)" : "transparent" }}
              >
                <WatchStar itemType="industry" targetId={r.id} initialActive={watchKeys.industryIds.has(r.id)} />
                <span className="tnum text-[13px] font-semibold">
                  {today}{" "}
                  {highlighted && (
                    <span className="font-mono text-[9.5px] text-[var(--rd-accent)]">
                      #{weekAgo}→#{today}
                    </span>
                  )}
                </span>
                <span className="truncate text-[13.5px] font-bold">{r.nameZh ?? r.name}</span>
                <span className="flex items-center gap-2">
                  <HeatBar score={r.scoreToday} color={heatBarColor(r.scoreToday, r.status as IndustryStatus)} />
                  <span className="tnum text-[13px] font-bold">{r.scoreToday.toFixed(0)}</span>
                </span>
                <span className="text-[14px] font-semibold" style={{ color: trend.color }}>
                  {trend.glyph}
                </span>
                <span className="text-[11.5px] font-medium" style={{ color: flow.color }}>
                  {flow.label}
                </span>
                <span className="text-[11.5px] font-medium" style={{ color: lead.color }}>
                  {lead.label}
                </span>
                <StatusChip badge={badge} />
              </ClickableRow>
            );
          })}

          <div className="flex items-center gap-4.5" style={{ borderTop: "2px solid var(--rd-rule)", marginTop: 2, paddingTop: 10 }}>
            <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">最弱產業</span>
            {weakest3.map((r) => (
              <Link key={r.id} href={`/industries/${r.slug}`} className="text-[11.5px] font-medium" style={{ color: "#3dae7c" }}>
                {r.nameZh ?? r.name} {r.scoreToday.toFixed(0)} {trendFromDelta(r.scoreChange).glyph}
              </Link>
            ))}
            <span className="ml-auto text-[10px] text-[var(--rd-text-muted)]">資金持續流出 · 領先指標惡化</span>
          </div>

          {continuingThemes.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3" style={{ borderTop: "2px solid var(--rd-rule)", paddingTop: 12 }}>
              <span className="text-[12px] font-bold">主題監測</span>
              <span className="text-[10px] text-[var(--rd-text-muted)]">具延續性</span>
              {continuingThemes.map((r) => (
                <span key={r.id} className="px-[9px] py-[3px] text-[11px]" style={{ border: "1px solid rgba(255,86,60,.5)", color: "#ff8a70" }}>
                  {r.nameZh ?? r.name} · {r.majorCatalyst}
                </span>
              ))}
              {overheated.length > 0 && (
                <>
                  <span className="ml-2.5 text-[10px] text-[var(--rd-text-muted)]">已過熱</span>
                  {overheated.map((r) => (
                    <span key={r.id} className="px-[9px] py-[3px] text-[11px]" style={{ border: "1px solid rgba(230,178,58,.5)", color: "#e6c26a" }}>
                      {r.nameZh ?? r.name} · 產業過熱
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* -------------------------- right rail -------------------------- */}
        <div className="flex flex-col gap-4">
          <div>
            <SectionHeader title="領先指標異動" kicker="SIGNALS" />
            {indicatorMovers.map((ind, i) => (
              <div
                key={ind.id}
                className="flex items-center gap-2.5 py-2.25"
                style={i < indicatorMovers.length - 1 ? { borderBottom: "1px solid var(--rd-line)" } : undefined}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[12px] font-semibold">{ind.name}</div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-[var(--rd-text-muted)]">
                    {ind.sourceName ?? "—"} · {ind.date}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tnum text-[13px] font-bold">
                    {num(ind.value, ind.value != null && Math.abs(ind.value) < 20 ? 2 : 1)} {ind.unit}
                  </div>
                  <div className="tnum text-[11px] font-semibold" style={{ color: (ind.higherIsBetter ? (ind.pctChange ?? 0) > 0 : (ind.pctChange ?? 0) < 0) ? "#ff5a3d" : "#3dae7c" }}>
                    {pct(ind.pctChange, 1)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <SectionHeader title="資金輪動" kicker="ROTATION" />
            <div className="flex items-center gap-3 pt-3 pb-1">
              <div className="flex-1 p-2.5" style={{ border: "1px solid rgba(61,174,124,.4)" }}>
                <div className="text-[9.5px] font-medium" style={{ color: "#3dae7c" }}>
                  流出
                </div>
                <div className="mt-1 text-[12px] leading-[1.7] font-semibold">
                  {outflow3.map((f) => (
                    <div key={f.id}>
                      {f.nameZh ?? f.name} {yiFlow(f.foreignNet + f.trustNet)}億
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-[16px] font-bold" style={{ color: "#ff5a3d" }}>
                →
              </div>
              <div className="flex-1 p-2.5" style={{ border: "1px solid rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }}>
                <div className="text-[9.5px] font-medium" style={{ color: "#ff8a70" }}>
                  流入
                </div>
                <div className="mt-1 text-[12px] leading-[1.7] font-semibold">
                  {inflow3.map((f) => (
                    <div key={f.id}>
                      {f.nameZh ?? f.name} {yiFlow(f.foreignNet + f.trustNet)}億
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="風險與催化" kicker="RISK / EVENTS" />
            {riskEvents.length ? (
              riskEvents.map((a, i) => (
                <div
                  key={a.id}
                  className="flex items-baseline gap-2 py-2"
                  style={i < riskEvents.length - 1 ? { borderBottom: "1px solid var(--rd-line)" } : undefined}
                >
                  <span
                    className="h-[7px] w-[7px] shrink-0"
                    style={{ background: a.importance === "high" ? "#ff563c" : a.importance === "medium" ? "#e6b23a" : "rgba(243,242,242,.4)" }}
                  />
                  <span className="text-[12px] leading-[1.5] font-medium">{a.title}</span>
                </div>
              ))
            ) : (
              <p className="py-2 text-[11px] text-[var(--rd-text-secondary)]">
                尚無風險或催化事件 — 執行 <code>npm run jobs:alerts</code>。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
