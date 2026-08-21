import type { ReactNode } from "react";

/** The section header used identically on every panel: 2px top rule → zh
 *  title (700 13px) + EN mono kicker + optional right-aligned note. */
export function SectionHeader({ title, kicker, note }: { title: string; kicker: string; note?: ReactNode }) {
  return (
    <div className="rd-rule flex items-baseline gap-2.5 pt-2.5">
      <span className="text-[13px] font-bold">{title}</span>
      <span className="font-mono text-[9px] tracking-[.16em] text-[var(--rd-text-muted)]">{kicker}</span>
      {note && <span className="ml-auto text-[10px] text-[var(--rd-text-muted)]">{note}</span>}
    </div>
  );
}
