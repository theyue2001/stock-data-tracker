/** The "#n" marker on a ranked list row. Top three are filled with the accent
 *  so a glance at a card finds the leaders without reading any digits. */
export function RankBadge({ rank, highlightTop = 3 }: { rank: number; highlightTop?: number }) {
  const lead = rank <= highlightTop;
  return (
    <span
      className="tnum inline-flex h-[19px] w-[19px] shrink-0 items-center justify-center font-mono text-[10.5px] font-bold"
      style={
        lead
          ? { background: "var(--rd-accent)", color: "var(--rd-bg)" }
          : { border: "1px solid var(--rd-line)", color: "var(--rd-text-secondary)" }
      }
    >
      {rank}
    </span>
  );
}
