import { getLatestDailyBrief } from "@/lib/queries";
import { BriefBullet } from "@/components/radar/brief-tag";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function DailyBriefPage() {
  const brief = await getLatestDailyBrief();

  if (!brief) {
    return (
      <div className="px-6 pb-6" style={{ maxWidth: 920 }}>
        <h1 className="py-[18px] text-[22px] font-black">每日市場簡報</h1>
        <p className="text-[12px] text-[var(--rd-text-secondary)]">
          尚無簡報 — 執行 <code>npm run jobs:brief</code>（或 <code>npm run jobs:daily</code> 執行完整流程：更新資料 → 計算分數 → 產生警示 → 產生簡報）。
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-7" style={{ maxWidth: 920 }}>
      <div className="flex flex-wrap items-baseline gap-3.5 py-[18px] pb-2.5">
        <h1 className="text-[22px] font-black">每日市場簡報</h1>
        <span className="font-mono text-[10.5px] text-[var(--rd-text-muted)]">
          {brief.date} · {new Date(brief.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} 生成
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Legend kind="fact" label="事實" />
          <Legend kind="inference" label="推論" />
          <Legend kind="risk" label="風險" />
        </span>
      </div>

      <Section n="01" title="市場摘要">
        <BriefBullet tag="fact">{brief.marketSummary}</BriefBullet>
      </Section>

      <Section n="02" title="資金輪動">
        <BriefBullet tag="inference">{brief.capitalRotation}</BriefBullet>
      </Section>

      <Section n="03" title="最強 / 最弱產業">
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

      <Section n="04" title="重要指標變化">
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

      <Section n="05" title="法人動向">
        <BriefBullet tag="fact">{brief.institutionalActivity}</BriefBullet>
      </Section>

      <Section n="06" title="新興主題">
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

      <Section n="07" title="監測個股">
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

      <Section n="08" title="過熱區">
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

      <Section n="09" title="主要風險">
        {brief.keyRisks.map((s, i) => (
          <BriefBullet key={i} tag="risk">
            {s}
          </BriefBullet>
        ))}
      </Section>

      <Section n="10" title="明日觀察">
        <div className="text-[12.5px] leading-[2] text-[rgba(243,242,242,.85)]">
          {brief.tomorrowWatchlist.map((s, i) => (
            <div key={i}>
              <span className="font-mono text-[10px] text-[var(--rd-text-muted)]">· </span>
              {s}
            </div>
          ))}
        </div>
      </Section>

      <p className="mt-4 text-[10.5px] leading-relaxed text-[var(--rd-text-muted)]" style={{ borderTop: "1px solid var(--rd-line)", paddingTop: 10 }}>
        本簡報為研究輔助用途，依 {brief.generatedBy === "mock" ? "規則式" : brief.generatedBy} 引擎由示範資料集產生，不構成買賣建議，亦不保證任何報酬。使用前請自行核對原始數據來源。
      </p>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "48px 1fr", columnGap: 16, borderTop: "2px solid var(--rd-rule)", marginTop: 12, paddingTop: 10 }}>
      <span className="font-mono text-[16px] font-extrabold text-[rgba(243,242,242,.3)]">{n}</span>
      <div>
        <div className="mb-0.5 text-[14px] font-bold">{title}</div>
        {children}
      </div>
    </div>
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
