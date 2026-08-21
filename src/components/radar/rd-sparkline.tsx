// Matches the handoff spec exactly: viewBox 0 0 280 64, preserveAspectRatio
// "none", x from 4 to 276, y padding 6/6, stroke-width 1.6, end dot r 2.6.
export function RdSparkline({ points, color, height = 64 }: { points: number[]; color: string; height?: number }) {
  if (points.length < 2) {
    return <svg viewBox="0 0 280 64" style={{ display: "block", width: "100%", height }} aria-hidden />;
  }
  const w = 280;
  const h = 64;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (w - 8) / (points.length - 1);

  const coords = points.map((v, i) => ({
    x: 4 + i * step,
    y: h - 6 - ((v - min) / range) * (h - 12),
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg viewBox="0 0 280 64" preserveAspectRatio="none" style={{ display: "block", width: "100%", height }}>
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={last.x} cy={last.y} r={2.6} fill={color} />
    </svg>
  );
}
