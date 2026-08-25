import Link from "next/link";
import { getCapitalFlow } from "@/lib/queries";
import { getIndustryMomentum } from "@/lib/sentiment-queries";
import { compact, pct } from "@/lib/format";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { PageHeader, PageShell, ScrollHint } from "@/components/layout/page";
import { Panel } from "@/components/radar/panel";
import { StatusChip } from "@/components/radar/status-chip";
import { RankChange } from "@/components/sentiment/rank-change";
import { directionColor, tint, yiFlow } from "@/lib/radar-ui";
import { SENTIMENT_STATUS_BADGE, sentimentTextColor } from "@/lib/sentiment-ui";

const COLUMNS = "104px 96px 84px 84px 84px 84px 68px 84px minmax(190px,1fr)";

export default async function CapitalFlowPage() {
  const [flow, momentum] = await Promise.all([getCapitalFlow(), getIndustryMomentum()]);
  const sentimentBySlug = new Map(momentum.industries.map((s) => [s.slug, s]));

  const rows = flow.industries.map((f) => {
    const last5 = f.history.slice(-5);
    const d5 = last5.reduce((sum, h) => sum + h.foreignNet + h.trustNet, 0);
    return { ...f, d5, sentiment: sentimentBySlug.get(f.slug) ?? null };
  });

  // Rotation confirmed by breadth: money came in over five sessions AND the
  // group's short-term sentiment ranking improved today. Either signal alone
  // can be one large print or one stock's move; together they describe a
  // group the market is actually rotating into.
  const confirmedRotation = rows
    .filter((r) => r.d5 > 0 && r.sentiment && r.sentiment.rankDelta > 0)
    .sort((a, b) => (b.sentiment?.rankDelta ?? 0) - (a.sentiment?.rankDelta ?? 0))
    .slice(0, 4);

  // Money in, but the group is NOT participating — the divergence worth seeing.
  const unconfirmedInflow = rows
    .filter((r) => r.d5 > 0 && r.sentiment && r.sentiment.sentimentScore < 50)
    .sort((a, b) => b.d5 - a.d5)
    .slice(0, 4);

  const maxForeign = Math.max(1, ...rows.map((r) => Math.abs(r.foreignNet)));
  const maxTrust = Math.max(1, ...rows.map((r) => Math.abs(r.trustNet)));
  const maxDealer = Math.max(1, ...rows.map((r) => Math.abs(r.dealerNet)));
  const maxMargin = Math.max(1, ...rows.map((r) => Math.abs(r.marginChange)));
  // Industry-scope margin is only ever non-zero when a provider actually
  // supplied an NT$ figure. All-zero means "not published", and the tint scale
  // below would otherwise render a meaningless uniform wash.
  const marginPublished = rows.some((r) => r.marginChange !== 0);
  const maxVol = Math.max(1, ...rows.map((r) => Math.abs(r.volumeChangePct)));
  const maxD5 = Math.max(1, ...rows.map((r) => Math.abs(r.d5)));

  const byD5 = [...rows].sort((a, b) => b.d5 - a.d5);
  // Only genuinely positive/negative rows qualify — with real data (unlike
  // the handoff's fictional set) it's common for fewer than 3 industries to
  // sit on either side, and forcing exactly 3 would mislabel a mildly
  // positive industry as "outflow".
  const inflow3 = byD5.filter((f) => f.d5 > 0).slice(0, 3);
  const outflow3 = byD5.filter((f) => f.d5 < 0).slice(-3).reverse();

  return (
    <PageShell>
      <PageHeader
        title="資金流向"
        note="單位：億元 · 收盤更新"
        subtitle="法人 × 產業 · 看見資金正在離開誰、進入誰"
      />

      {flow.market && (
        <KpiStrip
          cells={[
            {
              label: "外資",
              value: (
                <>
                  {yiFlow(flow.market.foreignNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(flow.market.foreignNet),
            },
            {
              label: "投信",
              value: (
                <>
                  {yiFlow(flow.market.trustNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(flow.market.trustNet),
            },
            {
              label: "自營商",
              value: (
                <>
                  {yiFlow(flow.market.dealerNet)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(flow.market.dealerNet),
            },
            {
              label: "融資變動",
              value: (
                <>
                  {yiFlow(flow.market.marginChange)} <span className="text-[12px] font-medium">億</span>
                </>
              ),
              valueColor: directionColor(flow.market.marginChange),
              sub: `${flow.market.date}`,
            },
          ]}
        />
      )}

      <div className="mt-3 sm:mt-4">
      <Panel
        title="產業資金熱圖"
        kicker="FLOW HEATMAP"
        note="紅＝買超/流入 · 綠＝賣超/流出 · 氣氛＝短線廣度 0–100 · 點產業名開細節"
      >
        <ScrollHint minWidth={1010}>
          <div
            className="grid items-center pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)]"
            style={{ gridTemplateColumns: COLUMNS, columnGap: 6, borderBottom: "1px solid var(--rd-rule)" }}
          >
            <span>產業</span>
            <span>氣氛 / 排名</span>
            <span className="text-right">外資</span>
            <span className="text-right">投信</span>
            <span className="text-right">自營</span>
            <span className="text-right">融資變動</span>
            <span className="text-right">成交值</span>
            <span className="text-right">量能 vs 5日</span>
            <span className="pl-3.5">5 日累計買賣超</span>
          </div>
          {rows.map((f) => {
            const fa = tint(f.foreignNet, maxForeign);
            const ta = tint(f.trustNet, maxTrust);
            const da = tint(f.dealerNet, maxDealer);
            // No tint when the column has nothing to show, or every row gets the
            // same faint wash and it reads as data.
            const mg = marginPublished ? tint(f.marginChange, maxMargin) : { bg: "transparent", color: "rgba(243,242,242,.4)" };
            const ve = tint(f.volumeChangePct, maxVol);
            const half = Math.min(Math.abs(f.d5) / maxD5, 1) * 100;
            return (
              <div
                key={f.id}
                className="grid items-center py-0.5"
                style={{ gridTemplateColumns: COLUMNS, columnGap: 6, borderBottom: "1px solid var(--rd-line)" }}
              >
                <Link href={`/industries/${f.slug}`} className="text-[12px] font-bold hover:text-[#ff8a70]">
                  {f.nameZh ?? f.name}
                </Link>
                <span className="flex items-baseline gap-1.5">
                  {f.sentiment ? (
                    <>
                      <span className="tnum text-[12px] font-bold" style={{ color: sentimentTextColor(f.sentiment.sentimentScore) }}>
                        {f.sentiment.sentimentScore.toFixed(0)}
                      </span>
                      <RankChange
                        rank={f.sentiment.rank}
                        previousRank={f.sentiment.previousRank}
                        delta={f.sentiment.rankDelta}
                        compact
                      />
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--rd-text-muted)]">—</span>
                  )}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold" style={{ background: fa.bg, color: fa.color }}>
                  {yiFlow(f.foreignNet)}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold" style={{ background: ta.bg, color: ta.color }}>
                  {yiFlow(f.trustNet)}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold" style={{ background: da.bg, color: da.color }}>
                  {yiFlow(f.dealerNet)}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold" style={{ background: mg.bg, color: mg.color }}>
                  {/* Neither exchange publishes a per-stock margin LOAN amount — only a
                      balance in 張 — so writeStockFlows deliberately stores nothing here
                      rather than valuing share counts at the close, which would be off by
                      0.4x-2.6x and sometimes the wrong sign. An em dash says "not
                      published"; a 0 would read as "no change". */}
                  {marginPublished ? yiFlow(f.marginChange) : "—"}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold text-[rgba(243,242,242,.55)]">
                  {compact(f.turnover * 1000)}
                </span>
                <span className="tnum py-[7px] px-2 text-right text-[11.5px] font-semibold" style={{ background: ve.bg, color: ve.color }}>
                  {pct(f.volumeChangePct, 0)}
                </span>
                <span className="flex items-center gap-2 pl-3.5">
                  <span className="flex flex-1 justify-end">
                    <span className="block h-2" style={{ width: `${f.d5 < 0 ? half : 0}%`, background: "#3dae7c" }} />
                  </span>
                  <span className="h-3.5 w-px shrink-0" style={{ background: "rgba(243,242,242,.3)" }} />
                  <span className="flex-1">
                    <span className="block h-2" style={{ width: `${f.d5 > 0 ? half : 0}%`, background: "#ff563c" }} />
                  </span>
                  <span className="tnum w-11 text-right text-[11px] font-semibold" style={{ color: directionColor(f.d5) }}>
                    {yiFlow(f.d5)}
                  </span>
                </span>
              </div>
            );
          })}
        </ScrollHint>
      </Panel>
      </div>

      {(confirmedRotation.length > 0 || unconfirmedInflow.length > 0) && (
        <div className="mt-3 grid gap-3 sm:mt-4 sm:gap-4 lg:grid-cols-2">
          <div className="rd-card p-3 sm:p-3.5" style={{ borderColor: "rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }}>
            <div className="text-[10.5px] font-semibold" style={{ color: "#ff8a70" }}>
              資金流入 × 氣氛排名同步上升
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {confirmedRotation.length ? (
                confirmedRotation.map((f) => (
                  <Link key={f.id} href={`/industries/${f.slug}`} className="flex flex-wrap items-baseline gap-2 text-[12px] font-semibold">
                    <span>{f.nameZh ?? f.name}</span>
                    <span style={{ color: "#ff5a3d" }}>{yiFlow(f.d5)} 億</span>
                    <RankChange rank={f.sentiment!.rank} previousRank={f.sentiment!.previousRank} delta={f.sentiment!.rankDelta} compact />
                    <StatusChip badge={SENTIMENT_STATUS_BADGE[f.sentiment!.status]} compact />
                  </Link>
                ))
              ) : (
                <span className="text-[11px] text-[var(--rd-text-muted)]">本日無同時具備資金流入與氣氛排名上升的產業。</span>
              )}
            </div>
          </div>
          <div className="rd-card p-3 sm:p-3.5" style={{ borderColor: "rgba(230,178,58,.45)" }}>
            <div className="text-[10.5px] font-semibold" style={{ color: "#e6c26a" }}>
              資金流入但族群未同步（氣氛值 &lt; 50）
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {unconfirmedInflow.length ? (
                unconfirmedInflow.map((f) => (
                  <Link key={f.id} href={`/industries/${f.slug}`} className="flex flex-wrap items-baseline gap-2 text-[12px] font-semibold">
                    <span>{f.nameZh ?? f.name}</span>
                    <span style={{ color: "#ff5a3d" }}>{yiFlow(f.d5)} 億</span>
                    <span className="tnum text-[11px]" style={{ color: sentimentTextColor(f.sentiment!.sentimentScore) }}>
                      氣氛 {f.sentiment!.sentimentScore.toFixed(0)}
                    </span>
                    <span className="tnum text-[10.5px] text-[var(--rd-text-muted)]">
                      漲跌 {f.sentiment!.advancingCount}↑/{f.sentiment!.decliningCount}↓
                    </span>
                  </Link>
                ))
              ) : (
                <span className="text-[11px] text-[var(--rd-text-muted)]">本日無資金流入但族群未同步的產業。</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 sm:mt-4">
        <Panel title="資金重新分配" kicker="5-DAY ROTATION" note="5 日累計法人買賣超">
          <div className="flex flex-col items-stretch gap-2.5 lg:flex-row lg:items-center">
            <div className="rd-card min-w-0 flex-1 p-3 sm:p-3.5" style={{ borderColor: "rgba(61,174,124,.4)" }}>
              <div className="text-[10.5px] font-semibold" style={{ color: "#3dae7c" }}>
                資金流出
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {outflow3.length ? (
                  outflow3.map((f) => (
                    <Link key={f.id} href={`/industries/${f.slug}`} className="flex items-baseline gap-2 text-[var(--rd-text)]">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{f.nameZh ?? f.name}</span>
                      <span className="tnum shrink-0 text-[12px] font-bold" style={{ color: "#6cc79d" }}>
                        {yiFlow(f.d5)} 億
                      </span>
                    </Link>
                  ))
                ) : (
                  <span className="text-[11px] text-[var(--rd-text-muted)]">近 5 日無淨流出的產業。</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-row items-center justify-center gap-2 lg:flex-col lg:gap-1 lg:px-1.5">
              <span className="text-[18px] font-extrabold lg:text-[20px]" style={{ color: "#ff5a3d" }}>
                <span className="lg:hidden">↓</span>
                <span className="hidden lg:inline">→</span>
              </span>
              <span className="text-center text-[9.5px] font-medium text-[var(--rd-text-muted)]">法人資金重新分配</span>
            </div>
            <div
              className="rd-card min-w-0 flex-1 p-3 sm:p-3.5"
              style={{ borderColor: "rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }}
            >
              <div className="text-[10.5px] font-semibold" style={{ color: "#ff8a70" }}>
                資金流入
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                {inflow3.length ? (
                  inflow3.map((f) => (
                    <Link key={f.id} href={`/industries/${f.slug}`} className="flex items-baseline gap-2 text-[var(--rd-text)]">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{f.nameZh ?? f.name}</span>
                      <span className="tnum shrink-0 text-[12px] font-bold" style={{ color: "#ff5a3d" }}>
                        {yiFlow(f.d5)} 億
                      </span>
                    </Link>
                  ))
                ) : (
                  <span className="text-[11px] text-[var(--rd-text-muted)]">近 5 日無淨流入的產業。</span>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
