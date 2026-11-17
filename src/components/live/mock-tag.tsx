import { cn } from "@/lib/utils";

/**
 * Marks a figure whose stored row is demo data (`isMock`). Per-row, not
 * per-deployment: a database switched from demo to live keeps whatever mock
 * rows predate the switch. Hook-free so server and client components can
 * both render it.
 */
export function MockTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-block px-1 align-[1px] font-sans text-[9px] leading-[14px] font-medium whitespace-nowrap text-[var(--rd-text-muted)]",
        className,
      )}
      style={{ border: "1px solid var(--rd-line)" }}
      title="示意（mock）資料，非交易所實際數字"
    >
      示意資料
    </span>
  );
}
