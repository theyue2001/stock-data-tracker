import Link from "next/link";
import { getAlerts, getWatchlist } from "@/lib/queries";
import { removeWatchlistItem } from "@/app/watchlist/actions";
import { SectionHeader } from "@/components/radar/section-header";
import { StatusChip } from "@/components/radar/status-chip";
import { flowWord, trendFromDelta, INDUSTRY_STATUS_BADGE, STOCK_STATUS_BADGE, directionColor, displayRs } from "@/lib/radar-ui";
import { num, pct } from "@/lib/format";
import type { IndustryStatus, StockStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const [items, alerts] = await Promise.all([getWatchlist(), getAlerts(6)]);

  const industries = items.filter((i) => i.itemType === "industry");
  const stocks = items.filter((i) => i.itemType === "stock");
  const indicators = items.filter((i) => i.itemType === "indicator");

  return (
    <div className="px-6 pb-6" style={{ maxWidth: 1080 }}>
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px]">
        <h1 className="text-[22px] font-black">追蹤清單</h1>
        <span className="text-[11px] font-medium text-[var(--rd-text-secondary)]">在任何頁面點 ☆ 即加入 · 自動標記重要變化</span>
      </div>

      <div className="mb-4.5">
        <SectionHeader title="重要變化" kicker="ALERTS" />
        {alerts.length ? (
          alerts.map((a, i) => (
            <div key={a.id} className="flex gap-2.5 py-2.25" style={i < alerts.length - 1 ? { borderBottom: "1px solid var(--rd-line)" } : undefined}>
              <span className="mt-[5px] h-[7px] w-[7px] shrink-0" style={{ background: "var(--rd-accent)" }} />
              <span className="text-[12px] leading-[1.5] font-medium">{a.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[9.5px] text-[rgba(243,242,242,.38)]">
                {new Date(a.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            </div>
          ))
        ) : (
          <p className="py-2 text-[11.5px] text-[var(--rd-text-secondary)]">目前沒有系統偵測到的重要變化。</p>
        )}
      </div>

      <div className="mb-4.5">
        <SectionHeader title="追蹤產業" kicker="INDUSTRIES" />
        {industries.length === 0 ? (
          <p className="py-3 text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何產業 — 到 總覽 或 產業雷達 點 ☆ 加入。</p>
        ) : (
          industries.map((r) => {
            const trend = trendFromDelta(r.changeValue);
            const flow = flowWord(r.capitalFlowScore ?? 0);
            const badge = INDUSTRY_STATUS_BADGE[r.status as IndustryStatus] ?? INDUSTRY_STATUS_BADGE.neutral;
            return (
              <div
                key={r.id}
                className="grid items-center py-2"
                style={{ gridTemplateColumns: "26px 1fr 120px 44px 110px 110px", columnGap: 8, borderBottom: "1px solid var(--rd-line)" }}
              >
                <RemoveStar id={r.id} />
                <Link href={r.href} className="text-[13px] font-bold hover:text-[#ff8a70]">
                  {r.label}
                </Link>
                <span className="tnum text-[13px] font-bold">
                  熱度 {r.primaryValue.toFixed(0)} <span className="font-mono text-[9.5px]" style={{ color: directionColor(r.changeValue) }}>{r.changeValue >= 0 ? "+" : ""}{r.changeValue.toFixed(1)}</span>
                </span>
                <span className="text-[14px] font-semibold" style={{ color: trend.color }}>
                  {trend.glyph}
                </span>
                <span className="text-[11.5px] font-medium" style={{ color: flow.color }}>
                  {flow.label}
                </span>
                <StatusChip badge={badge} />
              </div>
            );
          })
        )}
      </div>

      <div className="mb-4.5">
        <SectionHeader title="追蹤個股" kicker="STOCKS" />
        {stocks.length === 0 ? (
          <p className="py-3 text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何個股 — 到 個股雷達 點 ☆ 加入。</p>
        ) : (
          stocks.map((r) => {
            const badge = STOCK_STATUS_BADGE[r.status as StockStatus] ?? STOCK_STATUS_BADGE.high_level_consolidation;
            return (
              <div
                key={r.id}
                className="grid items-center py-2"
                style={{ gridTemplateColumns: "26px 1fr 80px 70px 60px 110px 110px", columnGap: 8, borderBottom: "1px solid var(--rd-line)" }}
              >
                <RemoveStar id={r.id} />
                <span className="min-w-0">
                  <Link href={r.href} className="text-[13px] font-bold hover:text-[#ff8a70]">
                    {r.label}
                  </Link>
                  <span className="ml-1.5 text-[9.5px] text-[var(--rd-text-muted)]">{r.sublabel}</span>
                </span>
                <span className="tnum text-right text-[12.5px] font-semibold">{num(r.primaryValue, 2)}</span>
                <span className="tnum text-right text-[12px] font-bold" style={{ color: directionColor(r.changeValue) }}>
                  {pct(r.changeValue, 1)}
                </span>
                <span className="tnum text-[11px] font-semibold">{r.relativeStrength != null ? displayRs(r.relativeStrength) : "—"}</span>
                <span className="text-[10.5px] font-medium" style={{ color: (r.foreignNet ?? 0) >= 0 ? "#ff8a70" : "#6cc79d" }}>
                  外資 {(((r.foreignNet ?? 0) / 100_000)).toFixed(1)}億
                </span>
                <StatusChip badge={badge} compact />
              </div>
            );
          })
        )}
      </div>

      <div>
        <SectionHeader title="追蹤指標" kicker="INDICATORS" />
        {indicators.length === 0 ? (
          <p className="py-3 text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何領先指標 — 到 領先指標 頁面加入。</p>
        ) : (
          indicators.map((r) => (
            <div key={r.id} className="grid items-center py-2" style={{ gridTemplateColumns: "26px 1fr 100px 90px", columnGap: 8, borderBottom: "1px solid var(--rd-line)" }}>
              <RemoveStar id={r.id} />
              <Link href={r.href} className="text-[13px] font-bold hover:text-[#ff8a70]">
                {r.label}
              </Link>
              <span className="tnum text-right text-[12.5px] font-semibold">{num(r.primaryValue, 2)}</span>
              <span className="tnum text-right text-[12px] font-bold" style={{ color: directionColor(r.changeValue) }}>
                {pct(r.changeValue, 1)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RemoveStar({ id }: { id: string }) {
  return (
    <form action={removeWatchlistItem}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label="移除追蹤" className="cursor-pointer text-[13px]" style={{ color: "var(--rd-accent)" }}>
        ★
      </button>
    </form>
  );
}
