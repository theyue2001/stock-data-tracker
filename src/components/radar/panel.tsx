import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A boxed section.
 *
 * Every screen is now composed of these rather than of bands separated by the
 * 2px Modernist rule. The rule reads fine on a wide sheet, but on a phone
 * every band is the same width and the rules stop dividing anything — a box
 * still does, and it gives the section an obvious extent to tap.
 *
 * Layout only: the header/body/footer padding and the hairline between rows
 * live in `.rd-card-*` (src/app/globals.css) so a card looks identical on
 * every page without each caller restating it.
 */
export function Panel({
  title,
  kicker,
  note,
  children,
  footer,
  className,
  bodyClassName,
  /** Skip the body padding — for a card whose child is a full-bleed table or
   *  its own row list. */
  flush = false,
}: {
  title: string;
  kicker?: string;
  note?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section className={cn("rd-card flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="rd-card-head">
        <h2 className="text-[13px] font-bold">{title}</h2>
        {kicker && <span className="font-mono text-[9px] tracking-[.16em] text-[var(--rd-text-muted)]">{kicker}</span>}
        {note && <span className="ml-auto text-[10px] leading-[1.5] text-[var(--rd-text-muted)]">{note}</span>}
      </div>
      <div className={cn("min-w-0 flex-1", flush ? undefined : "rd-card-body", bodyClassName)}>{children}</div>
      {footer && <div className="rd-card-foot">{footer}</div>}
    </section>
  );
}

/**
 * The "there is more behind this card" affordance — the other half of showing
 * only highlights on the overview. Sits in a Panel footer so the summary and
 * the way into the detail are never separated.
 */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--rd-accent-word)] hover:text-[var(--rd-accent-hover)]"
    >
      {children}
      <span aria-hidden className="font-mono">
        →
      </span>
    </Link>
  );
}

/** A hairline-separated row inside a Panel body. Use with `flush` so the rows
 *  run to the card edge and only the row itself carries padding. */
export function PanelRows({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("rd-card-rows", className)} style={style}>
      {children}
    </div>
  );
}
