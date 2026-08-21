export function HeatBar({ score, color, width = 84 }: { score: number; color: string; width?: number }) {
  return (
    <span className="inline-block h-1 shrink-0" style={{ width, background: "rgba(243,242,242,.12)" }}>
      <span className="block h-1" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }} />
    </span>
  );
}
