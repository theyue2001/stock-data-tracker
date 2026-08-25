import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface KpiCellData {
  label: string;
  value: ReactNode;
  valueColor?: string;
  sub?: ReactNode;
  /** Gives the cell the accent tint — for the one figure the screen leads on
   *  (the index on 總覽, the heat score on a detail page). */
  emphasis?: boolean;
}

/**
 * Was a single strip with hairline-divided cells: N equal columns, always N,
 * which on a phone made every cell ~60px wide and clipped its label.
 *
 * Now each KPI is its own box in a grid that reflows — 2 across on a phone,
 * the full row on a wide screen. The column counts are keyed off the number of
 * cells so a 4-cell strip doesn't leave two empty slots on desktop.
 */
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

export function KpiStrip({ cells, className }: { cells: KpiCellData[]; className?: string }) {
  return (
    <div className={cn("grid gap-2 sm:gap-2.5", COLUMNS[cells.length] ?? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4", className)}>
      {cells.map((c, i) => (
        <div
          key={i}
          className="rd-card min-w-0 px-3 py-2.5 sm:px-3.5 sm:py-3"
          style={c.emphasis ? { borderColor: "rgba(255,86,60,.45)", background: "rgba(255,86,60,.06)" } : undefined}
        >
          <div className="text-[10px] leading-[1.4] font-medium text-[var(--rd-text-secondary)]">{c.label}</div>
          <div
            className="tnum mt-1 text-[17px] leading-[1.2] font-bold sm:text-[20px]"
            style={{ color: c.valueColor }}
          >
            {c.value}
          </div>
          {c.sub && <div className="mt-1 text-[10.5px] leading-[1.45] text-[var(--rd-text-secondary)]">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
