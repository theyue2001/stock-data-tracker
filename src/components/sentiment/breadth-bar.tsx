/**
 * Compact horizontal breadth bar (spec §7): 上漲 / 平盤 / 下跌 as three
 * proportional segments.
 *
 * This is the control that stops "產業 +5%, ten names rising" and
 * "產業 +5%, one limit-up and nine flat" from looking identical — the number
 * alone cannot separate them, the bar can.
 *
 * Taiwan convention: red = advancing, green = declining.
 */
export function BreadthBar({
  advancing,
  flat,
  declining,
  width = 62,
  height = 6,
}: {
  advancing: number;
  flat: number;
  declining: number;
  width?: number;
  height?: number;
}) {
  const total = advancing + flat + declining;
  const label = `上漲 ${advancing} · 平盤 ${flat} · 下跌 ${declining}`;

  if (total === 0) {
    return <span className="inline-block shrink-0" style={{ width, height, background: "rgba(243,242,242,.12)" }} aria-label="無成分股資料" />;
  }

  const pctOf = (n: number) => (n / total) * 100;

  return (
    <span
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width, height, background: "rgba(243,242,242,.12)" }}
      role="img"
      aria-label={label}
      title={label}
    >
      <span style={{ width: `${pctOf(advancing)}%`, background: "#ff563c" }} />
      <span style={{ width: `${pctOf(flat)}%`, background: "rgba(243,242,242,.28)" }} />
      <span style={{ width: `${pctOf(declining)}%`, background: "#3dae7c" }} />
    </span>
  );
}

/** "8↑ / 1→ / 1↓" — the same counts in text, coloured by direction. Pairs
 *  with the bar so the reading is exact as well as glanceable. */
export function BreadthCounts({ advancing, flat, declining }: { advancing: number; flat: number; declining: number }) {
  return (
    <span className="tnum text-[11.5px] font-semibold whitespace-nowrap">
      <span style={{ color: "#ff5a3d" }}>{advancing}↑</span>
      <span className="text-[var(--rd-text-muted)]"> / </span>
      <span style={{ color: "rgba(243,242,242,.55)" }}>{flat}→</span>
      <span className="text-[var(--rd-text-muted)]"> / </span>
      <span style={{ color: "#3dae7c" }}>{declining}↓</span>
    </span>
  );
}
