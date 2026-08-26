import { Panel } from "@/components/radar/panel";
import { StatusChip } from "@/components/radar/status-chip";
import { HeatBar } from "@/components/radar/heat-bar";
import { BreadthBar, BreadthCounts } from "@/components/sentiment/breadth-bar";
import { RankChange, RankTrend } from "@/components/sentiment/rank-change";
import { SentimentSpark } from "@/components/sentiment/sentiment-spark";
import { pct } from "@/lib/format";
import { LOW_CONFIDENCE_BADGE, directionColor, yiFlow } from "@/lib/radar-ui";
import {
  FLOW_SOURCE_NOTE,
  QUADRANT_META,
  SENTIMENT_STATUS_BADGE,
  institutionWord,
  sentimentBarColor,
  sentimentTextColor,
  sentimentTrendGlyph,
  volumeWord,
} from "@/lib/sentiment-ui";
import type { IndustrySentimentPanel } from "@/lib/sentiment-queries";

/**
 * 短線氣氛 panel for the Industry Detail page (spec §8).
 *
 * Deliberately boxed and separately headed so it reads as a SECOND, distinct
 * reading rather than more detail about the heat score above it — the two
 * scores answer different questions over different horizons and routinely
 * disagree, which is the point of showing both.
 */
export function SentimentPanel({ panel }: { panel: IndustrySentimentPanel }) {
  const badge = SENTIMENT_STATUS_BADGE[panel.status];
  const trend = sentimentTrendGlyph(panel.scoreDelta);
  const vol = volumeWord(panel.volumeRatio);
  const inst = institutionWord(panel.foreignNet, panel.trustNet, panel.dealerNet);
  const hasFlow = panel.flowSource !== "none";
  const flowNote = FLOW_SOURCE_NOTE[panel.flowSource];
  const quadrant = QUADRANT_META[panel.quadrant];
  const barColor = sentimentBarColor(panel.sentimentScore, panel.status);

  return (
    <Panel title="短線氣氛" kicker="SHORT-TERM SENTIMENT" note={`${panel.date} · 與中期產業熱度分開計算`}>
      <>
        {/* headline: score + rank + status */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-[var(--rd-text-secondary)]">氣氛值 SENTIMENT</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tnum text-[30px] leading-none font-extrabold" style={{ color: sentimentTextColor(panel.sentimentScore) }}>
                {panel.sentimentScore.toFixed(0)}
              </span>
              <span className="tnum text-[14px] font-semibold" style={{ color: trend.color }}>
                {trend.glyph}
                {panel.scoreDelta !== 0 && ` ${Math.abs(panel.scoreDelta).toFixed(1)}`}
              </span>
              <span className="text-[10px] text-[var(--rd-text-muted)]">vs 昨日</span>
            </div>
            <div className="mt-2 flex w-full max-w-[150px]">
              <HeatBar score={panel.sentimentScore} color={barColor} grow />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-medium text-[var(--rd-text-secondary)]">今日排名 RANK</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tnum text-[22px] leading-none font-extrabold">#{panel.rank}</span>
              <span className="text-[10px] text-[var(--rd-text-muted)]">／ {panel.universeSize} 個產業</span>
            </div>
            <div className="mt-1.5">
              <RankChange rank={panel.rank} previousRank={panel.previousRank} delta={panel.rankDelta} />
            </div>
          </div>

          <div className="ml-auto flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-1.5">
              {panel.lowConfidence ? <StatusChip badge={LOW_CONFIDENCE_BADGE} compact /> : null}
              <StatusChip badge={badge} />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[9.5px] text-[var(--rd-text-muted)]">近 {panel.sentimentTrend.length} 日</span>
              <SentimentSpark points={panel.sentimentTrend} color={barColor} width={72} height={22} />
            </span>
          </div>
        </div>

        {/* component readings — the six inputs behind the score */}
        <div
          className="mt-3.5 grid gap-x-4 gap-y-0 sm:grid-cols-2 lg:grid-cols-3"
          style={{ borderTop: "1px solid var(--rd-line)", paddingTop: 10 }}
        >
          <Metric label="漲跌家數" score={panel.components.advancingRatio}>
            <span className="flex items-center gap-2">
              <BreadthBar advancing={panel.advancingCount} flat={panel.flatCount} declining={panel.decliningCount} width={40} />
              <BreadthCounts advancing={panel.advancingCount} flat={panel.flatCount} declining={panel.decliningCount} />
            </span>
          </Metric>

          <Metric label="平均漲幅" score={panel.components.averageReturn}>
            <span className="tnum text-[12.5px] font-bold" style={{ color: directionColor(panel.averageReturnPct) }}>
              {pct(panel.averageReturnPct)}
            </span>
          </Metric>

          <Metric label="量能擴張" score={panel.components.volumeExpansion}>
            <span className="tnum text-[12.5px] font-bold" style={{ color: vol.color }}>
              {vol.label}
            </span>
            <span className="ml-1.5 text-[9.5px] text-[var(--rd-text-muted)]">vs 20 日均量</span>
          </Metric>

          <Metric label="突破家數" score={panel.components.breakoutRatio}>
            <span className="tnum text-[12.5px] font-bold" style={{ color: panel.breakoutCount > 0 ? "#ff8a70" : "rgba(243,242,242,.55)" }}>
              {panel.breakoutCount} / {panel.stockCount}
            </span>
          </Metric>

          {/* With no T86 print for the session there are no figures to show:
              the stored component is an inert 50 and the raw nets are stored as
              0, so both the word and the 億 figure would assert a balanced
              session the report never reported. */}
          <Metric label="法人流向" score={hasFlow ? panel.components.institutionalFlowScore : null}>
            {hasFlow ? (
              <>
                <span className="text-[12.5px] font-bold" style={{ color: inst.color }}>
                  {inst.label}
                </span>
                <span className="tnum ml-1.5 text-[10px] font-semibold" style={{ color: directionColor(panel.foreignNet + panel.trustNet) }}>
                  {yiFlow(panel.foreignNet + panel.trustNet)} 億
                </span>
              </>
            ) : (
              <span className="text-[12.5px] font-bold" style={{ color: "rgba(243,242,242,.4)" }} title={flowNote?.title}>
                {flowNote?.label ?? "無資料"}
              </span>
            )}
          </Metric>

          <Metric label="相對強度" score={panel.components.relativeStrengthScore}>
            <span className="tnum text-[12.5px] font-bold" style={{ color: directionColor(panel.relativeStrengthPct) }}>
              {pct(panel.relativeStrengthPct, 1)}
            </span>
            <span className="ml-1.5 text-[9.5px] text-[var(--rd-text-muted)]">vs 加權指數</span>
          </Metric>
        </div>

        {/* ranking path + the sentiment-vs-heat reading */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2" style={{ borderTop: "1px solid var(--rd-line)", paddingTop: 10 }}>
          <span className="flex items-baseline gap-2">
            <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">排名走勢</span>
            <RankTrend ranks={panel.rankTrend} />
          </span>
        </div>

        <div className="rd-card mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 p-3" style={{ background: "var(--rd-card-hover)" }}>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">短線氣氛</span>
            <span className="tnum text-[15px] font-bold" style={{ color: sentimentTextColor(panel.sentimentScore) }}>
              {panel.sentimentScore.toFixed(0)}
            </span>
          </span>
          <span className="text-[11px] text-[var(--rd-text-muted)]">vs</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-medium text-[var(--rd-text-muted)]">中期產業熱度</span>
            <span className="tnum text-[15px] font-bold">{panel.heatScore.toFixed(0)}</span>
          </span>
          <span className="px-2 py-[3px] text-[10.5px] font-medium" style={{ border: `1px solid ${quadrant.color}`, color: quadrant.color }}>
            {quadrant.label}
          </span>
          <span className="text-[10.5px] text-[var(--rd-text-secondary)]">{quadrant.note}</span>
        </div>

        <p className="mt-2.5 text-[9.5px] leading-[1.7] text-[var(--rd-text-muted)]">
          短線氣氛衡量「今天這個族群是不是整體在動」——廣度、量能、法人參與、相對強度；中期產業熱度衡量基本面、領先指標、資金流、技術面與催化事件。兩者刻意分開，數值不互相取代，也不構成買賣建議。
        </p>
      </>
    </Panel>
  );
}

/** One component reading: zh label, the raw measure, and the 0-100 component
 *  score it normalized to — so a reader can always see how a raw figure fed
 *  the headline number.
 *
 *  `score === null` means the component had no data and was dropped from the
 *  weighting, so there is no number to show and the headline was computed
 *  without it. Rendering the stored filler value here would put a fabricated
 *  reading next to five real ones. */
function Metric({ label, score, children }: { label: string; score: number | null; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[7px]" style={{ borderBottom: "1px solid var(--rd-line)" }}>
      <span className="shrink-0 text-[10.5px] font-medium text-[var(--rd-text-muted)]">{label}</span>
      <span className="flex items-baseline gap-1.5 text-right">
        {children}
        <span
          className="tnum w-7 shrink-0 text-right font-mono text-[9.5px] text-[rgba(243,242,242,.4)]"
          title={score === null ? `${label}無資料，未計入氣氛值加權` : `${label}分項分數 ${score.toFixed(1)} / 100`}
        >
          {score === null ? "—" : score.toFixed(0)}
        </span>
      </span>
    </div>
  );
}
