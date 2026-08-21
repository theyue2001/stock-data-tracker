"use client";

/** Filter/sort chip: default 1px border 70% text; active solid accent fill,
 *  ink text, weight 700; hover accent border. */
export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer px-[11px] py-1 text-[11.5px] transition-colors"
      style={
        active
          ? { background: "var(--rd-accent)", border: "1px solid var(--rd-accent)", color: "var(--rd-bg)", fontWeight: 700 }
          : { border: "1px solid rgba(243,242,242,.3)", color: "rgba(243,242,242,.7)", fontWeight: 500 }
      }
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = "rgba(255,86,60,.6)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = "rgba(243,242,242,.3)";
      }}
    >
      {label}
    </button>
  );
}
