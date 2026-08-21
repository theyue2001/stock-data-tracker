import { ClickableRow } from "@/components/radar/clickable-row";
import { StatusChip } from "@/components/radar/status-chip";
import { WatchStar } from "@/components/radar/watch-star";
import {
  INDUSTRY_STATUS_BADGE,
  flowWord,
  fundamentalWord,
  heatBarColor,
  leadingIndicatorWord,
  rankDeltaText,
  technicalWord,
  trendFromDelta,
} from "@/lib/radar-ui";
import type { IndustryRadarRow } from "@/lib/queries";
import type { IndustryStatus } from "@/lib/types";

/** 產業雷達 card — spec: title row (name + ☆ + badge) / score row (30px heat +
 *  trend + rank delta + RANK #n) / 4px heat bar / 2x2 momentum grid / 催化 /
 *  風險. Whole card navigates to the industry detail; the star intercepts
 *  its own click. */
export function IndustryCard({ row, rank, rankDelta, watched }: { row: IndustryRadarRow; rank: number; rankDelta: number; watched: boolean }) {
  const status = row.status as IndustryStatus;
  const badge = INDUSTRY_STATUS_BADGE[status];
  const trend = trendFromDelta(row.scoreChange);
  const delta = rankDeltaText(rankDelta);
  const flow = flowWord(row.components.capitalFlow);
  const lead = leadingIndicatorWord(row.components.leadingIndicator);
  const fund = fundamentalWord(row.components.fundamental);
  const tech = technicalWord(row.components.technical);

  return (
    <ClickableRow
      href={`/industries/${row.slug}`}
      className="flex flex-col gap-2.5 p-4"
      style={{ background: "var(--rd-panel)", border: "1px solid var(--rd-line)" }}
      hoverBackground="var(--rd-panel)"
    >
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-bold">{row.nameZh ?? row.name}</span>
        <WatchStar itemType="industry" targetId={row.id} initialActive={watched} />
        <span className="ml-auto">
          <StatusChip badge={badge} />
        </span>
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-[30px] font-extrabold">{row.scoreToday.toFixed(0)}</span>
        <span className="text-[17px] font-semibold" style={{ color: trend.color }}>
          {trend.glyph}
        </span>
        <span className="font-mono text-[11px] font-semibold" style={{ color: delta.color }}>
          {delta.text}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">RANK #{rank}</span>
      </div>
      <div className="h-1" style={{ background: "rgba(243,242,242,.12)" }}>
        <div className="h-1" style={{ width: `${row.scoreToday}%`, background: heatBarColor(row.scoreToday, status) }} />
      </div>
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-1.5">
        <MomentumCell label="資金流" word={flow} />
        <MomentumCell label="領先指標" word={lead} />
        <MomentumCell label="基本面動能" word={fund} />
        <MomentumCell label="技術面動能" word={tech} />
      </div>
      {row.majorCatalyst && (
        <div className="flex gap-2">
          <span className="shrink-0 pt-px text-[9.5px] font-medium text-[var(--rd-text-muted)]">催化</span>
          <span className="text-[11.5px] leading-[1.5] font-medium">{row.majorCatalyst}</span>
        </div>
      )}
      {row.majorRisk && (
        <div className="flex gap-2">
          <span className="shrink-0 pt-px text-[9.5px] font-medium text-[var(--rd-text-muted)]">風險</span>
          <span className="text-[11px] leading-[1.5] text-[rgba(243,242,242,.6)]">{row.majorRisk}</span>
        </div>
      )}
    </ClickableRow>
  );
}

function MomentumCell({ label, word }: { label: string; word: { label: string; color: string } }) {
  return (
    <div className="flex items-center justify-between py-[3px]" style={{ borderBottom: "1px solid var(--rd-line)" }}>
      <span className="text-[10.5px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      <span className="text-[11.5px] font-medium" style={{ color: word.color }}>
        {word.label}
      </span>
    </div>
  );
}
