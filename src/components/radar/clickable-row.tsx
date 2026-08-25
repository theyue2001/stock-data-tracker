"use client";

import { useRouter } from "next/navigation";
import type { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** A whole row/card that navigates on click while still allowing a nested
 *  WatchStar (or any element calling stopPropagation) to intercept its own
 *  click first — mirrors the handoff's `onClick={{ r.open }}` row pattern,
 *  which is a plain div handler rather than an <a>, precisely so the star
 *  can live inside it.
 *
 *  Press feedback is CSS (`.rd-tap`, or `.rd-card-tap` for a whole card),
 *  not JS mouse handlers: a handler that writes `element.style.background`
 *  on mouseleave has to guess what to write back, and it gives a touch
 *  device — which never fires either event — no feedback at all. */
export function ClickableRow({
  href,
  children,
  className,
  style,
  /** Skip the built-in row hover so a caller can supply its own (e.g. a card
   *  using `.rd-card-tap`). */
  noTapStyle = false,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  noTapStyle?: boolean;
}) {
  const router = useRouter();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") router.push(href);
      }}
      className={cn("cursor-pointer", !noTapStyle && "rd-tap", className)}
      style={style}
    >
      {children}
    </div>
  );
}
