import Link from "next/link";
import { getAlerts, getWatchlist } from "@/lib/queries";
import { removeWatchlistItem } from "@/app/watchlist/actions";
import { PageHeader, PageShell } from "@/components/layout/page";
import { Panel, PanelRows } from "@/components/radar/panel";
import { StatusChip } from "@/components/radar/status-chip";
import { flowWord, trendFromDelta, INDUSTRY_STATUS_BADGE, STOCK_STATUS_BADGE, directionColor, displayRs } from "@/lib/radar-ui";
import { num, pct } from "@/lib/format";
import type { IndustryStatus, StockStatus } from "@/lib/types";

export default async function WatchlistPage() {
  const [items, alerts] = await Promise.all([getWatchlist(), getAlerts(6)]);

  const industries = items.filter((i) => i.itemType === "industry");
  const stocks = items.filter((i) => i.itemType === "stock");
  const indicators = items.filter((i) => i.itemType === "indicator");

  return (
    <PageShell maxWidth={1080}>
      <PageHeader title="追蹤清單" subtitle="在任何頁面點 ☆ 即加入 · 自動標記重要變化" />

      <div className="flex flex-col gap-3 sm:gap-4">
        <Panel title="重要變化" kicker="ALERTS" note={`最新 ${alerts.length} 則`} flush>
          {alerts.length ? (
            <PanelRows>
              {alerts.map((a) => (
                <div key={a.id} className="flex gap-2.5 px-3 py-2.5 sm:px-3.5">
                  <span className="mt-[5px] h-[7px] w-[7px] shrink-0" style={{ background: "var(--rd-accent)" }} />
                  <span className="min-w-0 flex-1 text-[12px] leading-[1.55] font-medium">{a.title}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-[rgba(243,242,242,.38)]">
                    {new Date(a.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                  </span>
                </div>
              ))}
            </PanelRows>
          ) : (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">目前沒有系統偵測到的重要變化。</p>
          )}
        </Panel>

        {/* Every watched row used to be a fixed-column grid — "26px 1fr 120px
            44px 110px 110px" and friends — which on a phone left the name
            column a few characters wide. Each row is now a two-line block that
            reflows: identity on the first line, figures on the second. */}
        <Panel title="追蹤產業" kicker="INDUSTRIES" note={`${industries.length} 個`} flush>
          {industries.length === 0 ? (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何產業 — 到 總覽 或 產業雷達 點 ☆ 加入。</p>
          ) : (
            <PanelRows>
              {industries.map((r) => {
                const trend = trendFromDelta(r.changeValue);
                // `?? null`, never `?? 0`: a missing score is 無資料, and 0 is
                // the bottom of the scale (強力流出), not a stand-in for absence.
                const flow = flowWord(r.capitalFlowScore ?? null);
                const badge = INDUSTRY_STATUS_BADGE[r.status as IndustryStatus] ?? INDUSTRY_STATUS_BADGE.neutral;
                return (
                  <div key={r.id} className="flex flex-col gap-1.5 px-3 py-2.5 sm:px-3.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <RemoveStar id={r.id} />
                      <Link href={r.href} className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--rd-text)] hover:text-[#ff8a70]">
                        {r.label}
                      </Link>
                      <span className="shrink-0">
                        <StatusChip badge={badge} compact />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-[22px]">
                      <span className="tnum text-[13px] font-bold">
                        熱度 {r.primaryValue.toFixed(0)}{" "}
                        <span className="font-mono text-[9.5px]" style={{ color: directionColor(r.changeValue) }}>
                          {r.changeValue >= 0 ? "+" : ""}
                          {r.changeValue.toFixed(1)}
                        </span>
                      </span>
                      <span className="text-[14px] font-semibold" style={{ color: trend.color }}>
                        {trend.glyph}
                      </span>
                      <span className="text-[11.5px] font-medium" style={{ color: flow.color }}>
                        資金 {flow.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </PanelRows>
          )}
        </Panel>

        <Panel title="追蹤個股" kicker="STOCKS" note={`${stocks.length} 檔`} flush>
          {stocks.length === 0 ? (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何個股 — 到 個股雷達 點 ☆ 加入。</p>
          ) : (
            <PanelRows>
              {stocks.map((r) => {
                const badge = STOCK_STATUS_BADGE[r.status as StockStatus] ?? STOCK_STATUS_BADGE.high_level_consolidation;
                return (
                  <div key={r.id} className="flex flex-col gap-1.5 px-3 py-2.5 sm:px-3.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <RemoveStar id={r.id} />
                      <Link href={r.href} className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--rd-text)] hover:text-[#ff8a70]">
                        {r.label}
                        {r.sublabel && <span className="ml-1.5 text-[9.5px] font-medium text-[var(--rd-text-muted)]">{r.sublabel}</span>}
                      </Link>
                      <span className="shrink-0">
                        <StatusChip badge={badge} compact />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-[22px]">
                      <span className="tnum text-[12.5px] font-semibold">{num(r.primaryValue, 2)}</span>
                      <span className="tnum text-[12px] font-bold" style={{ color: directionColor(r.changeValue) }}>
                        {pct(r.changeValue, 1)}
                      </span>
                      <span className="tnum text-[11px] font-semibold">
                        RS {r.relativeStrength != null ? displayRs(r.relativeStrength) : "—"}
                      </span>
                      <span className="text-[10.5px] font-medium" style={{ color: (r.foreignNet ?? 0) >= 0 ? "#ff8a70" : "#6cc79d" }}>
                        外資 {((r.foreignNet ?? 0) / 100_000).toFixed(1)}億
                      </span>
                    </div>
                  </div>
                );
              })}
            </PanelRows>
          )}
        </Panel>

        <Panel title="追蹤指標" kicker="INDICATORS" note={`${indicators.length} 項`} flush>
          {indicators.length === 0 ? (
            <p className="rd-card-body text-[11.5px] text-[var(--rd-text-secondary)]">尚未追蹤任何領先指標 — 到 領先指標 頁面加入。</p>
          ) : (
            <PanelRows>
              {indicators.map((r) => (
                <div key={r.id} className="flex min-w-0 items-center gap-2 px-3 py-2.5 sm:px-3.5">
                  <RemoveStar id={r.id} />
                  <Link href={r.href} className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--rd-text)] hover:text-[#ff8a70]">
                    {r.label}
                  </Link>
                  <span className="tnum shrink-0 text-[12.5px] font-semibold">{num(r.primaryValue, 2)}</span>
                  <span className="tnum shrink-0 text-[12px] font-bold" style={{ color: directionColor(r.changeValue) }}>
                    {pct(r.changeValue, 1)}
                  </span>
                </div>
              ))}
            </PanelRows>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}

function RemoveStar({ id }: { id: string }) {
  return (
    <form action={removeWatchlistItem} className="shrink-0 leading-none">
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label="移除追蹤" className="cursor-pointer text-[13px] leading-none" style={{ color: "var(--rd-accent)" }}>
        ★
      </button>
    </form>
  );
}
