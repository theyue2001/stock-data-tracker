import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The outer padding every screen shares.
 *
 * Was a flat `px-6` on each page, which spends 48px of a 390px phone on
 * margins. 16px on a phone, 24px from `sm` up. `min-w-0` matters: without it a
 * dense grid child forces the shell wider than the viewport and the whole page
 * scrolls sideways instead of the one table that needs to.
 */
export function PageShell({ children, className, maxWidth }: { children: ReactNode; className?: string; maxWidth?: number }) {
  return (
    <div className={cn("min-w-0 px-4 pb-8 sm:px-6", className)} style={maxWidth ? { maxWidth } : undefined}>
      {children}
    </div>
  );
}

/** Title row: h1, an optional one-line subtitle, and an optional right-aligned
 *  mono note that drops onto its own line rather than squeezing the title. */
export function PageHeader({
  title,
  subtitle,
  note,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  note?: ReactNode;
  backHref?: string;
  backLabel?: string;
  /** Extra inline elements after the title — a status chip, a watch star. */
  children?: ReactNode;
}) {
  return (
    <div className="pt-4 pb-3.5 sm:pt-[18px]">
      {backHref && (
        <Link href={backHref} className="mb-2 inline-block text-[11px] font-medium text-[var(--rd-text-secondary)] hover:text-[var(--rd-accent-word)]">
          ← {backLabel ?? "返回"}
        </Link>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-[20px] leading-tight font-black sm:text-[22px]">{title}</h1>
        {children}
        {note && <span className="ml-auto font-mono text-[10px] text-[var(--rd-text-muted)]">{note}</span>}
      </div>
      {subtitle && <p className="mt-1.5 text-[11px] leading-[1.5] font-medium text-[var(--rd-text-secondary)]">{subtitle}</p>}
    </div>
  );
}

/**
 * Wrapper for a table too dense to reflow. Scrolls horizontally instead of
 * compressing its columns, and says so on touch widths — a table that clips
 * silently reads as broken, one that announces it scrolls reads as a table.
 */
export function ScrollHint({ children, minWidth, note }: { children: ReactNode; minWidth: number; note?: string }) {
  return (
    <>
      <div className="rd-scroll-x scrollbar-thin">
        <div style={{ minWidth }}>{children}</div>
      </div>
      <p className="pt-2 text-[10px] text-[var(--rd-text-muted)] lg:hidden">← {note ?? "左右滑動看完整欄位"} →</p>
    </>
  );
}
