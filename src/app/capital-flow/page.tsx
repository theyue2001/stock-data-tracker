import Link from "next/link";
import { getCapitalFlow } from "@/lib/queries";
import { getIndustryMomentum } from "@/lib/sentiment-queries";
import { compact, pct } from "@/lib/format";
import { KpiStrip } from "@/components/radar/kpi-strip";
import { StatusChip } from "@/components/radar/status-chip";
import { RankChange } from "@/components/sentiment/rank-change";
import { directionColor, tint, yiFlow } from "@/lib/radar-ui";
import { SENTIMENT_STATUS_BADGE, sentimentTextColor } from "@/lib/sentiment-ui";

export const dynamic = "force-dynamic";

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
    <div className="px-6 pb-6">
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px]">
        <h1 className="text-[22px] font-black">資金流向</h1>
        <span className="text-[11px] font-medium text-[var(--rd-text-secondary)]">法人 × 產業 · 看見資金正在離開誰、進入誰</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">單位：億元 · 收盤更新</span>
      </div>

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

      <div className="rd-rule flex items-baseline gap-2.5 pt-2.5" style={{ marginTop: 18 }}>
        <span className="text-[13px] font-bold">產業資金熱圖</span>
        <span className="font-mono text-[9px] tracking-[.16em] text-[var(--rd-text-muted)]">FLOW HEATMAP</span>
        <span className="ml-auto text-[10px] text-[var(--rd-text-muted)]">紅＝買超/流入 · 綠＝賣超/流出 · 氣氛＝短線廣度 0–100 · 點產業名開細節</span>
      </div>

      <div className="scrollbar-thin overflow-x-auto">
        <div style={{ minWidth: 1010 }}>
          <div
            className="grid items-center py-2.5 pb-[7px] text-[10px] font-medium text-[var(--rd-text-muted)]"
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
            const mg = tint(f.marginChange, maxMargin);
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
                  {yiFlow(f.marginChange)}
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
        </div>
      </div>

      {(confirmedRotation.length > 0 || unconfirmedInflow.length > 0) && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 18, borderTop: "2px solid var(--rd-rule)", paddingTop: 14 }}>
          <div className="p-3.5" style={{ border: "1px solid rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }}>
            <div className="text-[10px] font-medium" style={{ color: "#ff8a70" }}>
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
          <div className="p-3.5" style={{ border: "1px solid rgba(230,178,58,.45)" }}>
            <div className="text-[10px] font-medium" style={{ color: "#e6c26a" }}>
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

      <div className="grid items-stretch gap-4" style={{ gridTemplateColumns: "1fr auto 1fr", marginTop: 18, borderTop: "2px solid var(--rd-rule)", paddingTop: 14 }}>
        <div className="p-3.5" style={{ border: "1px solid rgba(61,174,124,.4)" }}>
          <div className="text-[10px] font-medium" style={{ color: "#3dae7c" }}>
            資金流出（5 日累計）
          </div>
          <div className="mt-2 flex flex-wrap gap-4.5">
            {outflow3.map((f) => (
              <span key={f.id} className="text-[13px] font-semibold">
                {f.nameZh ?? f.name} <span style={{ color: "#6cc79d" }}>{yiFlow(f.d5)} 億</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 px-1.5">
          <span className="text-[20px] font-extrabold" style={{ color: "#ff5a3d" }}>
            →
          </span>
          <span className="text-center text-[9.5px] font-medium text-[var(--rd-text-muted)]">法人資金重新分配</span>
        </div>
        <div className="p-3.5" style={{ border: "1px solid rgba(255,86,60,.5)", background: "rgba(255,86,60,.07)" }}>
          <div className="text-[10px] font-medium" style={{ color: "#ff8a70" }}>
            資金流入（5 日累計）
          </div>
          <div className="mt-2 flex flex-wrap gap-4.5">
            {inflow3.map((f) => (
              <span key={f.id} className="text-[13px] font-semibold">
                {f.nameZh ?? f.name} <span style={{ color: "#ff5a3d" }}>{yiFlow(f.d5)} 億</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
