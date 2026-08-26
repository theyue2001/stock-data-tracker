import Link from "next/link";
import {
  getAlerts,
  getCapitalFlow,
  getIndicatorOverview,
  getIndustryRadar,
  getMarketStatus,
  getStockRadar,
  getWatchlistKeys,
} from "@/lib/queries";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getIndustryMomentum } from "@/lib/sentiment-queries";
import { PageHeader, PageShell } from "@/components/layout/page";
import { Panel, PanelLink, PanelRows } from "@/components/radar/panel";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { HeatBar } from "@/components/radar/heat-bar";
import { RankBadge } from "@/components/radar/rank-badge";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import { ClickableRow } from "@/components/radar/clickable-row";
import { RankChange } from "@/components/sentiment/rank-change";
import { BreadthCounts } from "@/components/sentiment/breadth-bar";
import { SENTIMENT_STATUS_BADGE, sentimentBarColor, sentimentTextColor, sentimentTrendGlyph } from "@/lib/sentiment-ui";
import {
  INDUSTRY_STATUS_BADGE,
  directionColor,
  displayRs,
  flowWord,
  heatBarColor,
  leadingIndicatorWord,
  trendFromDelta,
  yiFlow,
} from "@/lib/radar-ui";
import type { IndustryStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// 總覽 / OVERVIEW
//
// A digest, not a workspace. Every block here is the top few rows of a screen
// that owns the full dataset, and every block links to it — the reader should
// be able to answer "what moved today" without scrolling past one viewport,
// and get the detail by tapping through rather than by reading further down.
// The full tables live on /industries, /momentum, /capital-flow, /stocks,
// /indicators and /watchlist.
// ---------------------------------------------------------------------------

/** How many rows a highlight panel shows before deferring to its own page. */
const TOP_N = 5;

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
  const [market, radar, flow, indicators, alerts, watchKeys, momentum, stocks] = await Promise.all([
    getMarketStatus(),
    getIndustryRadar(),
    getCapitalFlow(),
    getIndicatorOverview(),
    getAlerts(4),
    getWatchlistKeys(),
    getIndustryMomentum(),
    getStockRadar(),
  ]);

  const byScoreToday = [...radar].sort((a, b) => b.scoreToday - a.scoreToday);
  const byScoreWeekAgo = [...radar].sort((a, b) => b.scoreWeekAgo - a.scoreWeekAgo);
  const rankToday = new Map(byScoreToday.map((r, i) => [r.id, i + 1]));
  const rankWeekAgo = new Map(byScoreWeekAgo.map((r, i) => [r.id, i + 1]));

  const topHeat = byScoreToday.slice(0, TOP_N);
  const weakest3 = [...byScoreToday].slice(-3).reverse();

  const overheated = radar.filter((r) => r.status === "overheated");
  const riskTemp = overheated.length ? { label: "偏熱", color: "#e6b23a" } : { label: "正常", color: "#f3f2f2" };

  // Short-term momentum leaders. The full three-tab table is /momentum; the
  // overview shows only the head of the 多方 list.
  const bullCount = momentum.industries.filter((s) => s.sentimentScore >= 50).length;
  const topSentiment = [...momentum.industries].sort((a, b) => b.sentimentScore - a.sentimentScore).slice(0, TOP_N);

  const sortedFlow = [...flow.industries].sort((a, b) => b.foreignNet + b.trustNet - (a.foreignNet + a.trustNet));
  // Only genuinely positive/negative rows qualify — see the identical note on
  // the Capital Flow page.
  const inflow3 = sortedFlow.filter((f) => f.foreignNet + f.trustNet > 0).slice(0, 3);
  const outflow3 = sortedFlow.filter((f) => f.foreignNet + f.trustNet < 0).slice(-3).reverse();

  const topStocks = [...stocks].sort((a, b) => b.changePct - a.changePct).slice(0, TOP_N);

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

  // 三大法人 figures are a separate, rate-limited report from the index
  // close and can miss a run; getMarketStatus then falls back to the last
  // session that actually reported them rather than a defaulted 0. Say so
  // whenever that fallback is in effect, so a gap doesn't read as "flat".
  const flowSub = market?.detailStale ? `法人買賣超 · ${market.detailDate} 資料` : "法人買賣超";

  return (
    <PageShell>
      <PageHeader title="市場總覽" note="LAST UPDATE 20:00 TST" subtitle="每個區塊只列重點 — 點卡片右下角進入完整資料">
        {market && (
          <span className="bg-[rgba(255,86,60,.14)] px-2.5 py-1 text-[11px] font-bold text-[#ff8a70]">
            {regimeLabel(market.changePct, radar)}
          </span>
        )}
      </PageHeader>

      {market ? (
        <KpiStrip
          cells={[
            {
              label: "加權指數 TAIEX",
              value: num(market.close, 2),
              valueColor: directionColor(market.changePct),
              emphasis: true,
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
              sub: flowSub,
            },
            {
              label: "投信",
              value: (
                <>
                  {yiFlow(market.trustNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(market.trustNet),
              sub: flowSub,
            },
            {
              label: "自營商",
              value: (
                <>
                  {yiFlow(market.dealerNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(market.dealerNet),
              sub: flowSub,
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
        <div className="rd-card rd-card-body text-[12px] text-[var(--rd-text-secondary)]">
          尚無市場資料 — 執行 <code>npm run db:seed</code>。
        </div>
      )}

      <div className="mt-3 grid min-w-0 items-start gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-2">
        {/* ------------------------- 短線氣氛 TOP 5 -------------------------
            First card on the page: "is the whole group moving today" is the
            question the overview exists to answer, and it is the one reading
            that goes stale by tomorrow. */}
        <Panel
          title={`短線氣氛 TOP ${TOP_N}`}
          kicker="TODAY'S MOMENTUM"
          note={momentum.date ? `${momentum.date} · 單日廣度與參與度` : "尚無資料"}
          flush
          footer={<PanelLink href="/momentum">完整產業氣氛（多方 / 空方 / 細產業）</PanelLink>}
        >
          {topSentiment.length ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 pt-2.5 pb-1 sm:px-3.5">
                <Stat label="多方族群" value={`${bullCount} / ${momentum.industries.length}`} color="#ff5a3d" />
                <Stat label="空方族群" value={`${momentum.industries.length - bullCount}`} color="#3dae7c" />
                <Stat label="短線過熱" value={`${momentum.industries.filter((s) => s.status === "overheated").length}`} color="#e6c26a" />
              </div>
              <PanelRows>
                {topSentiment.map((s, i) => {
                  const trend = sentimentTrendGlyph(s.scoreDelta);
                  return (
                    <ClickableRow
                      key={s.id}
                      href={`/industries/${s.slug}`}
                      className="flex flex-col gap-1.5 px-3 py-2.5 sm:px-3.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <RankBadge rank={i + 1} />
                        <span className="truncate text-[13.5px] font-bold">{s.nameZh ?? s.name}</span>
                        <WatchStar itemType="industry" targetId={s.id} initialActive={watchKeys.industryIds.has(s.id)} />
                        <span className="ml-auto shrink-0">
                          <StatusChip badge={SENTIMENT_STATUS_BADGE[s.status]} compact />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="tnum shrink-0 text-[15px] font-bold" style={{ color: sentimentTextColor(s.sentimentScore) }}>
                          {s.sentimentScore.toFixed(0)}
                        </span>
                        <span className="tnum shrink-0 text-[10.5px] font-semibold" style={{ color: trend.color }}>
                          {trend.glyph}
                          {s.scoreDelta !== 0 && Math.abs(s.scoreDelta).toFixed(0)}
                        </span>
                        <span className="flex min-w-[44px] max-w-[120px] flex-1 items-center">
                          <HeatBar score={s.sentimentScore} color={sentimentBarColor(s.sentimentScore, s.status)} grow />
                        </span>
                        <BreadthCounts advancing={s.advancingCount} flat={s.flatCount} declining={s.decliningCount} />
                        <RankChange rank={s.rank} previousRank={s.previousRank} delta={s.rankDelta} compact />
                      </div>
                    </ClickableRow>
                  );
                })}
              </PanelRows>
            </>
          ) : (
            <p className="rd-card-body text-[11.5px] leading-[1.7] text-[var(--rd-text-secondary)]">
              尚無氣氛值資料 — 執行 <code>npm run jobs:refresh</code>（或 <code>npm run db:reset</code> 重建含歷史的示範資料集）。
            </p>
          )}
        </Panel>

        {/* ------------------------- 產業熱度 TOP 5 ------------------------- */}
        <Panel
          title={`產業熱度 TOP ${TOP_N}`}
          kicker="MEDIUM-TERM HEAT"
          note="中期：基本面 · 領先指標 · 資金流 · 技術面 · 催化"
          flush
          footer={<PanelLink href="/industries">查看全部 {radar.length} 個產業</PanelLink>}
        >
          {topHeat.length ? (
            <>
              <PanelRows>
                {topHeat.map((r) => {
                  const today = rankToday.get(r.id)!;
                  const weekAgo = rankWeekAgo.get(r.id)!;
                  const jump = weekAgo - today;
                  const trend = trendFromDelta(r.scoreChange);
                  const fw = flowWord(r.components.capitalFlow);
                  const lw = leadingIndicatorWord(r.components.leadingIndicator);
                  const badge = INDUSTRY_STATUS_BADGE[r.status as IndustryStatus];

                  return (
                    <ClickableRow
                      key={r.id}
                      href={`/industries/${r.slug}`}
                      className={cn("flex flex-col gap-1.5 px-3 py-2.5 sm:px-3.5", jump >= 4 && "rd-hot")}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <RankBadge rank={today} />
                        <span className="truncate text-[13.5px] font-bold">{r.nameZh ?? r.name}</span>
                        <WatchStar itemType="industry" targetId={r.id} initialActive={watchKeys.industryIds.has(r.id)} />
                        {jump >= 4 && (
                          <span className="shrink-0 font-mono text-[9.5px] text-[var(--rd-accent)]">
                            #{weekAgo}→#{today}
                          </span>
                        )}
                        <span className="ml-auto shrink-0">
                          <StatusChip badge={badge} compact />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="tnum shrink-0 text-[15px] font-bold">{r.scoreToday.toFixed(0)}</span>
                        <span className="shrink-0 text-[13px] font-semibold" style={{ color: trend.color }}>
                          {trend.glyph}
                        </span>
                        <span className="flex min-w-[44px] max-w-[120px] flex-1 items-center">
                          <HeatBar score={r.scoreToday} color={heatBarColor(r.scoreToday, r.status as IndustryStatus)} grow />
                        </span>
                        <span className="text-[10.5px] font-medium whitespace-nowrap" style={{ color: fw.color }}>
                          資金 {fw.label}
                        </span>
                        <span className="text-[10.5px] font-medium whitespace-nowrap" style={{ color: lw.color }}>
                          指標 {lw.label}
                        </span>
                      </div>
                    </ClickableRow>
                  );
                })}
              </PanelRows>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 sm:px-3.5" style={{ borderTop: "1px solid var(--rd-line)" }}>
                <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">最弱產業</span>
                {weakest3.map((r) => (
                  <Link key={r.id} href={`/industries/${r.slug}`} className="text-[11.5px] font-medium" style={{ color: "#3dae7c" }}>
                    {r.nameZh ?? r.name} {r.scoreToday.toFixed(0)} {trendFromDelta(r.scoreChange).glyph}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">
              尚無熱度資料 — 執行 <code>npm run jobs:daily</code>。
            </p>
          )}
        </Panel>

        {/* ------------------------- 資金流向 ------------------------- */}
        <Panel
          title="資金流向"
          kicker="CAPITAL ROTATION"
          note="外資＋投信 · 單日 · 億元"
          footer={<PanelLink href="/capital-flow">完整法人 × 產業熱圖</PanelLink>}
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            <FlowBox
              tone="in"
              label="流入前三"
              rows={inflow3.map((f) => ({ id: f.id, slug: f.slug, name: f.nameZh ?? f.name, value: f.foreignNet + f.trustNet }))}
            />
            <FlowBox
              tone="out"
              label="流出前三"
              rows={outflow3.map((f) => ({ id: f.id, slug: f.slug, name: f.nameZh ?? f.name, value: f.foreignNet + f.trustNet }))}
            />
          </div>
        </Panel>

        {/* ------------------------- 個股焦點 TOP 5 ------------------------- */}
        <Panel
          title={`個股焦點 TOP ${TOP_N}`}
          kicker="TODAY'S MOVERS"
          note="依當日漲跌幅"
          flush
          footer={<PanelLink href="/stocks">查看全部 {stocks.length} 檔個股</PanelLink>}
        >
          {topStocks.length ? (
            <PanelRows>
              {topStocks.map((s, i) => {
                const rs = displayRs(s.relativeStrength ?? 100);
                return (
                  <ClickableRow
                    key={s.id}
                    href={`/industries/${s.industrySlug}`}
                    className="flex min-w-0 items-center gap-2 px-3 py-2.5 sm:px-3.5"
                  >
                    <RankBadge rank={i + 1} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate text-[13px] font-bold">{s.nameZh ?? s.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--rd-text-muted)]">{s.ticker}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[9.5px] text-[var(--rd-text-muted)]">{s.industryName}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-[13px] font-bold" style={{ color: directionColor(s.changePct) }}>
                        {pct(s.changePct, 1)}
                      </span>
                      <span className="tnum mt-0.5 block text-[10px] font-medium text-[var(--rd-text-muted)]">
                        {num(s.price, 2)} · RS {rs.toFixed(0)}
                      </span>
                    </span>
                    <WatchStar itemType="stock" targetId={s.id} initialActive={watchKeys.stockIds.has(s.id)} />
                  </ClickableRow>
                );
              })}
            </PanelRows>
          ) : (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚無個股資料。</p>
          )}
        </Panel>

        {/* ------------------------- 領先指標異動 ------------------------- */}
        <Panel
          title="領先指標異動"
          kicker="SIGNALS"
          note="變動幅度最大的 4 項"
          flush
          footer={<PanelLink href="/indicators">查看全部 {indicators.length} 項指標</PanelLink>}
        >
          {indicatorMovers.length ? (
            <PanelRows>
              {indicatorMovers.map((ind) => (
                <Link
                  key={ind.id}
                  href={`/industries/${ind.industrySlug}`}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-[var(--rd-text)] sm:px-3.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{ind.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[9.5px] text-[var(--rd-text-muted)]">
                      {ind.sourceName ?? "—"} · {ind.date}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-[13px] font-bold">
                      {num(ind.value, ind.value != null && Math.abs(ind.value) < 20 ? 2 : 1)} {ind.unit}
                    </span>
                    <span
                      className="tnum mt-0.5 block text-[11px] font-semibold"
                      style={{ color: (ind.higherIsBetter ? (ind.pctChange ?? 0) > 0 : (ind.pctChange ?? 0) < 0) ? "#ff5a3d" : "#3dae7c" }}
                    >
                      {pct(ind.pctChange, 1)}
                    </span>
                  </span>
                </Link>
              ))}
            </PanelRows>
          ) : (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚無領先指標資料。</p>
          )}
        </Panel>

        {/* ------------------------- 風險與催化 ------------------------- */}
        <Panel
          title="風險與催化"
          kicker="RISK / EVENTS"
          note="最新 3 則"
          flush
          footer={<PanelLink href="/watchlist">追蹤清單與完整警示</PanelLink>}
        >
          {riskEvents.length ? (
            <PanelRows>
              {riskEvents.map((a) => (
                <div key={a.id} className="flex items-baseline gap-2 px-3 py-2.5 sm:px-3.5">
                  <span
                    className="mt-[5px] h-[7px] w-[7px] shrink-0"
                    style={{ background: a.importance === "high" ? "#ff563c" : a.importance === "medium" ? "#e6b23a" : "rgba(243,242,242,.4)" }}
                  />
                  <span className="text-[12px] leading-[1.55] font-medium">{a.title}</span>
                </div>
              ))}
            </PanelRows>
          ) : (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">
              尚無風險或催化事件 — 執行 <code>npm run jobs:alerts</code>。
            </p>
          )}
        </Panel>
      </div>

      {(continuingThemes.length > 0 || overheated.length > 0) && (
        <div className="mt-3 sm:mt-4">
          <Panel title="主題監測" kicker="THEMES" note="具延續性 vs. 已過熱">
            <div className="flex flex-wrap gap-2">
              {continuingThemes.map((r) => (
                <Link
                  key={r.id}
                  href={`/industries/${r.slug}`}
                  className="px-[9px] py-[4px] text-[11px] leading-[1.5]"
                  style={{ border: "1px solid rgba(255,86,60,.5)", color: "#ff8a70" }}
                >
                  {r.nameZh ?? r.name} · {r.majorCatalyst}
                </Link>
              ))}
              {overheated.map((r) => (
                <Link
                  key={r.id}
                  href={`/industries/${r.slug}`}
                  className="px-[9px] py-[4px] text-[11px] leading-[1.5]"
                  style={{ border: "1px solid rgba(230,178,58,.5)", color: "#e6c26a" }}
                >
                  {r.nameZh ?? r.name} · 產業過熱
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </PageShell>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      <span className="tnum text-[12.5px] font-bold" style={{ color }}>
        {value}
      </span>
    </span>
  );
}

/** One side of the rotation reading. Boxed rather than divided by a rule so
 *  inflow and outflow read as two things being compared, not one list. */
function FlowBox({
  tone,
  label,
  rows,
}: {
  tone: "in" | "out";
  label: string;
  rows: Array<{ id: string; slug: string; name: string; value: number }>;
}) {
  const inflow = tone === "in";
  return (
    <div
      className="rd-card p-2.5 sm:p-3"
      style={
        inflow
          ? { borderColor: "rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }
          : { borderColor: "rgba(61,174,124,.4)" }
      }
    >
      <div className="text-[10px] font-semibold" style={{ color: inflow ? "#ff8a70" : "#3dae7c" }}>
        {label}
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.length ? (
          rows.map((r) => (
            <Link key={r.id} href={`/industries/${r.slug}`} className="flex items-baseline gap-2 text-[var(--rd-text)]">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{r.name}</span>
              <span className="tnum shrink-0 text-[12px] font-bold" style={{ color: inflow ? "#ff5a3d" : "#6cc79d" }}>
                {yiFlow(r.value)} 億
              </span>
            </Link>
          ))
        ) : (
          <span className="text-[11px] text-[var(--rd-text-muted)]">本日無{inflow ? "淨流入" : "淨流出"}的產業。</span>
        )}
      </div>
    </div>
  );
}
