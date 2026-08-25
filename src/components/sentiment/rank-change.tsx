import { rankChangeText } from "@/lib/sentiment-ui";

/**
 * "#9 → #1 ↑8" (spec §5). The module's whole premise is that the CHANGE
 * matters more than the level, so the previous rank is always shown next to
 * the current one rather than being hidden behind a hover.
 */
export function RankChange({
  rank,
  previousRank,
  delta,
  compact,
}: {
  rank: number;
  previousRank: number | null;
  delta: number;
  compact?: boolean;
}) {
  const r = rankChangeText(rank, previousRank, delta);
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span
        className={`tnum font-mono font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`}
        style={{ color: r.emphasis ? r.color : "rgba(243,242,242,.72)" }}
      >
        {r.path}
      </span>
      <span
        className={`tnum font-semibold ${compact ? "text-[10px]" : "text-[11.5px]"}`}
        style={{ color: r.color }}
      >
        {r.jump}
      </span>
    </span>
  );
}

/** "#11 → #8 → #6 → #3 → #1" — the full ranking path over the stored
 *  sessions (spec §10). Oldest first. */
export function RankTrend({ ranks }: { ranks: number[] }) {
  if (ranks.length < 2) {
    return <span className="text-[11px] text-[var(--rd-text-muted)]">尚無排名歷史</span>;
  }
  return (
    <span className="tnum flex flex-wrap items-baseline gap-1 font-mono text-[11.5px]">
      {ranks.map((r, i) => {
        const last = i === ranks.length - 1;
        const improved = i > 0 && r < ranks[i - 1];
        const worsened = i > 0 && r > ranks[i - 1];
        return (
          <span key={i} className="flex items-baseline gap-1">
            {i > 0 && <span className="text-[var(--rd-text-muted)]">→</span>}
            <span
              className={last ? "font-bold" : "font-medium"}
              style={{
                color: last
                  ? "#f3f2f2"
                  : improved
                    ? "#ff8a70"
                    : worsened
                      ? "#6cc79d"
                      : "rgba(243,242,242,.55)",
              }}
            >
              #{r}
            </span>
          </span>
        );
      })}
    </span>
  );
}
