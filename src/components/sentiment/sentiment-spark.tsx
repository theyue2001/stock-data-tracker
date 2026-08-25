/**
 * Compact 5-session sentiment sparkline (spec §10) — sized to sit inside a
 * table cell, unlike RdSparkline which is a full-width panel chart.
 *
 * Fixed 0-100 y-range rather than min/max-scaled: the whole point of the
 * sparkline here is "did this group's sentiment move a lot or a little", and
 * auto-scaling makes a two-point wobble look identical to a forty-point
 * surge. The reference line at 50 marks the neutral reading.
 */
export function SentimentSpark({
  points,
  color,
  width = 56,
  height = 18,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return <span className="inline-block" style={{ width, height }} aria-hidden />;
  }

  const pad = 2;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (height - pad * 2);

  const coords = points.map((v, i) => ({ x: pad + i * step, y: y(v) }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const mid = y(50);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
      role="img"
      aria-label={`近 ${points.length} 日氣氛值 ${points.map((p) => p.toFixed(0)).join(" → ")}`}
    >
      <line x1={0} y1={mid} x2={width} y2={mid} stroke="rgba(243,242,242,.16)" strokeWidth={1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.4} />
      <circle cx={last.x} cy={last.y} r={1.8} fill={color} />
    </svg>
  );
}
