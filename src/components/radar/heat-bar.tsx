import { cn } from "@/lib/utils";

/**
 * Score bar, 0–100.
 *
 * `grow` makes it a flex item that absorbs whatever width the row's fixed
 * elements leave — the shape a card needs, where the bar has no business
 * knowing how wide the card is. A `width: 100%` bar cannot do that job: as a
 * non-shrinking flex item it claims the whole row and its siblings overflow on
 * top of it.
 */
export function HeatBar({
  score,
  color,
  width = 84,
  grow = false,
}: {
  score: number;
  color: string;
  width?: number;
  grow?: boolean;
}) {
  const filled = Math.max(0, Math.min(100, score));
  return (
    <span
      className={cn("h-1", grow ? "block min-w-0 flex-1" : "inline-block shrink-0")}
      style={{ width: grow ? undefined : width, background: "rgba(243,242,242,.12)" }}
    >
      <span className="block h-1" style={{ width: `${filled}%`, background: color }} />
    </span>
  );
}
