import { getLatestDailyBrief } from "@/lib/queries";
import { BriefBullet } from "@/components/radar/brief-tag";
import { PageHeader, PageShell } from "@/components/layout/page";
import type { ReactNode } from "react";

export default async function DailyBriefPage() {
  const brief = await getLatestDailyBrief();

  if (!brief) {
    return (
      <PageShell maxWidth={920}>
        <PageHeader title="每日市場簡報" />
        <div className="rd-card rd-card-body text-[12px] leading-[1.7] text-[var(--rd-text-secondary)]">
          尚無簡報 — 執行 <code>npm run jobs:brief</code>（或 <code>npm run jobs:daily</code> 執行完整流程：更新資料 → 計算分數 → 產生警示 → 產生簡報）。
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth={920}>
      <PageHeader
        title="每日市場簡報"
        note={`${brief.date} · ${new Date(brief.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} 生成`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Legend kind="fact" label="事實" />
        <Legend kind="inference" label="推論" />
        <Legend kind="risk" label="風險" />
      </div>

      <Section n="01" title="市場摘要">
        <BriefBullet tag="fact">{brief.marketSummary}</BriefBullet>
      </Section>

      <Section n="02" title="短線產業氣氛">
        <BriefBullet tag="fact">{brief.sentimentSummary || "本日尚無產業氣氛資料。"}</BriefBullet>
        <SentimentGroup label="氣氛值上升最快" items={brief.sentimentRising} tag="fact" />
        <SentimentGroup label="氣氛值下降最快" items={brief.sentimentFalling} tag="fact" />
        <SentimentGroup label="排名躍升最多" items={brief.sentimentRankJumps} tag="fact" />
        <SentimentGroup label="強勢群聚" items={brief.sentimentStrongClusters} tag="inference" />
        <SentimentGroup label="短線過熱" items={brief.sentimentOverheated} tag="risk" />
        <p className="mt-1 text-[10px] text-[var(--rd-text-muted)]">
          短線氣氛為單日廣度與參與度讀數，與第 04 節的中期產業熱度分開計算；「短線過熱」描述漲勢延伸，非看空判斷。
        </p>
      </Section>

      <Section n="03" title="資金輪動">
        <BriefBullet tag="inference">{brief.capitalRotation}</BriefBullet>
      </Section>

      <Section n="04" title="最強 / 最弱產業">
        {brief.strongestIndustries.map((s, i) => (
          <BriefBullet key={`s${i}`} tag="fact">
            {s}
          </BriefBullet>
        ))}
        {brief.weakestIndustries.map((s, i) => (
          <BriefBullet key={`w${i}`} tag="fact">
            {s}
          </BriefBullet>
        ))}
      </Section>

      <Section n="05" title="重要指標變化">
        {brief.leadingIndicatorChanges.length ? (
          brief.leadingIndicatorChanges.map((s, i) => (
            <BriefBullet key={i} tag="fact">
              {s}
            </BriefBullet>
          ))
        ) : (
          <Empty />
        )}
      </Section>

      <Section n="06" title="法人動向">
        <BriefBullet tag="fact">{brief.institutionalActivity}</BriefBullet>
      </Section>

      <Section n="07" title="新興主題">
        {brief.emergingThemes.length ? (
          brief.emergingThemes.map((s, i) => (
            <BriefBullet key={i} tag="inference">
              {s}
            </BriefBullet>
          ))
        ) : (
          <Empty />
        )}
      </Section>

      <Section n="08" title="監測個股">
        {brief.stocksToWatch.length ? (
          brief.stocksToWatch.map((s, i) => (
            <BriefBullet key={i} tag="fact">
              {s}
            </BriefBullet>
          ))
        ) : (
          <Empty />
        )}
      </Section>

      <Section n="09" title="過熱區">
        {brief.overheatedThemes.length ? (
          brief.overheatedThemes.map((s, i) => (
            <BriefBullet key={i} tag="risk">
              {s}
            </BriefBullet>
          ))
        ) : (
          <Empty />
        )}
      </Section>

      <Section n="10" title="主要風險">
        {brief.keyRisks.map((s, i) => (
          <BriefBullet key={i} tag="risk">
            {s}
          </BriefBullet>
        ))}
      </Section>

      <Section n="11" title="明日觀察">
        <div className="text-[12.5px] leading-[2] text-[rgba(243,242,242,.85)]">
          {brief.tomorrowWatchlist.map((s, i) => (
            <div key={i}>
              <span className="font-mono text-[10px] text-[var(--rd-text-muted)]">· </span>
              {s}
            </div>
          ))}
        </div>
      </Section>

      <p className="rd-card rd-card-body mt-3 text-[10.5px] leading-relaxed text-[var(--rd-text-muted)]">
        本簡報為研究輔助用途，依 {brief.generatedBy === "mock" ? "規則式" : brief.generatedBy}{" "}
        引擎彙整本站已存資料產生，不構成買賣建議，亦不保證任何報酬。使用前請自行核對原始數據來源。
      </p>
    </PageShell>
  );
}

/** One labelled group inside the sentiment section. Renders nothing when the
 *  brief has no rows for it, rather than an empty heading. */
function SentimentGroup({ label, items, tag }: { label: string; items: string[]; tag: "fact" | "inference" | "risk" }) {
  if (!items.length) return null;
  return (
    <div className="mt-1.5">
      <div className="text-[10px] font-medium text-[var(--rd-text-muted)]">{label}</div>
      {items.map((s, i) => (
        <BriefBullet key={i} tag={tag}>
          {s}
        </BriefBullet>
      ))}
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="rd-card mb-2.5 overflow-hidden">
      <div className="rd-card-head">
        <span className="font-mono text-[13px] font-extrabold text-[rgba(243,242,242,.35)]">{n}</span>
        <h2 className="text-[14px] font-bold">{title}</h2>
      </div>
      <div className="rd-card-body">{children}</div>
    </section>
  );
}

function Empty() {
  return <p className="py-1 text-[11px] text-[var(--rd-text-muted)]">本節目前無資料。</p>;
}

function Legend({ kind, label }: { kind: "fact" | "inference" | "risk"; label: string }) {
  const style =
    kind === "fact"
      ? { background: "rgba(255,86,60,.16)", color: "#ff9783" }
      : kind === "risk"
        ? { background: "rgba(230,178,58,.14)", color: "#e6c26a" }
        : { border: "1px solid rgba(243,242,242,.35)", color: "rgba(243,242,242,.7)" };
  return (
    <span className="px-2 py-0.5 text-[9.5px] font-semibold" style={style}>
      {label}
    </span>
  );
}
