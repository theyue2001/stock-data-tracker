import type { BadgeStyle } from "@/lib/radar-ui";
import { cn } from "@/lib/utils";

/** Status badge: 10.5px text, 3px/8px padding, radius 0 — spec "Status badges". */
export function StatusChip({ badge, compact, className }: { badge: BadgeStyle; compact?: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block font-medium whitespace-nowrap", compact ? "px-[7px] py-[2px] text-[9.5px]" : "px-2 py-[3px] text-[10.5px]", className)}
      style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}
    >
      {badge.label}
    </span>
  );
}
