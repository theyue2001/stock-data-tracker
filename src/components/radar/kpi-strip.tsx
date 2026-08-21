import type { ReactNode } from "react";

export interface KpiCellData {
  label: string;
  value: ReactNode;
  valueColor?: string;
  sub?: ReactNode;
}

/** N-column KPI strip: 2px rule top, 1px rule bottom, cells split by
 *  hairlines. Cell = 10px label / 20px value / 11px sub-line. */
export function KpiStrip({ cells }: { cells: KpiCellData[] }) {
  return (
    <div
      className="rd-rule grid"
      style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)`, borderBottom: "1px solid var(--rd-line)" }}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          className="py-3"
          style={{
            paddingLeft: i === 0 ? 0 : 14,
            paddingRight: i === cells.length - 1 ? 0 : 14,
            borderRight: i === cells.length - 1 ? "none" : "1px solid var(--rd-line)",
          }}
        >
          <div className="text-[10px] font-medium text-[var(--rd-text-secondary)]">{c.label}</div>
          <div className="tnum mt-1 text-[20px] font-bold" style={{ color: c.valueColor }}>
            {c.value}
          </div>
          {c.sub && <div className="mt-0.5 text-[11px] text-[var(--rd-text-secondary)]">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
