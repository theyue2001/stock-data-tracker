"use client";

import { useRouter } from "next/navigation";
import type { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** A whole row/card that navigates on click while still allowing a nested
 *  WatchStar (or any element calling stopPropagation) to intercept its own
 *  click first — mirrors the handoff's `onClick={{ r.open }}` row pattern,
 *  which is a plain div handler rather than an <a>, precisely so the star
 *  can live inside it. */
export function ClickableRow({
  href,
  children,
  className,
  style,
  hoverBackground = "var(--rd-hover)",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  hoverBackground?: string;
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
      className={cn("cursor-pointer", className)}
      style={style}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverBackground)}
      onMouseLeave={(e) => (e.currentTarget.style.background = style?.background ? String(style.background) : "transparent")}
    >
      {children}
    </div>
  );
}
