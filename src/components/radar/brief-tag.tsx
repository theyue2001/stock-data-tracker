export type BriefTagKind = "fact" | "inference" | "risk";

const STYLE: Record<BriefTagKind, { label: string; bg: string; border: string; color: string }> = {
  fact: { label: "事實", bg: "rgba(255,86,60,.16)", border: "transparent", color: "#ff9783" },
  inference: { label: "推論", bg: "transparent", border: "rgba(243,242,242,.35)", color: "rgba(243,242,242,.7)" },
  risk: { label: "風險", bg: "rgba(230,178,58,.14)", border: "transparent", color: "#e6c26a" },
};

export function BriefTag({ kind }: { kind: BriefTagKind }) {
  const s = STYLE[kind];
  return (
    <span
      className="inline-block w-9 shrink-0 py-0.5 text-center text-[9.5px] font-semibold"
      style={{ background: s.bg, border: s.border !== "transparent" ? `1px solid ${s.border}` : undefined, color: s.color }}
    >
      {s.label}
    </span>
  );
}

export function BriefBullet({ tag, children }: { tag: BriefTagKind; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-[5px]">
      <BriefTag kind={tag} />
      <span className="text-[12.5px] leading-[1.75] text-[rgba(243,242,242,.85)]">{children}</span>
    </div>
  );
}
