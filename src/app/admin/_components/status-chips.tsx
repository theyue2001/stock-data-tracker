import type { CSSProperties, ReactNode } from "react";
import { HEALTH_LABEL, type HealthStatus } from "@/lib/health/status";
import { RUN_STATUS_LABEL } from "@/lib/health/format";
import { cn } from "@/lib/utils";

/**
 * Status chips for the health page.
 *
 * This site reads red as 漲 and green as 跌, so health cannot borrow either:
 * a green "正常" would read as a falling price and a red "失敗" as a rising
 * one. The four states are told apart by fill and border weight instead —
 * a solid inverted chip for failed, the existing warn amber for delayed, a
 * dashed outline for waiting, a plain outline for healthy — and every chip
 * carries its word and a glyph, so nothing depends on colour.
 */
type Tone = "ok" | "wait" | "warn" | "fail" | "muted";

const TONE_STYLE: Record<Tone, CSSProperties> = {
  ok: { background: "transparent", border: "1px solid rgba(243,242,242,.32)", color: "rgba(243,242,242,.82)" },
  wait: { background: "transparent", border: "1px dashed rgba(243,242,242,.42)", color: "rgba(243,242,242,.66)" },
  warn: { background: "rgba(230,178,58,.16)", border: "1px solid rgba(230,178,58,.55)", color: "var(--rd-warn-word)" },
  fail: { background: "var(--rd-text)", border: "1px solid var(--rd-text)", color: "var(--rd-bg)" },
  muted: { background: "transparent", border: "1px solid var(--rd-line)", color: "var(--rd-text-muted)" },
};

const TONE_GLYPH: Record<Tone, string> = { ok: "✓", wait: "…", warn: "!", fail: "✕", muted: "–" };

const HEALTH_TONE: Record<HealthStatus, Tone> = { healthy: "ok", waiting: "wait", delayed: "warn", failed: "fail" };

const RUN_TONE: Record<string, Tone> = {
  success: "ok",
  waiting: "wait",
  running: "wait",
  partial: "warn",
  failed: "fail",
  skipped: "muted",
};

function Chip({ tone, label, large, className }: { tone: Tone; label: string; large?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        large ? "px-2.5 py-[3px] text-[15px] font-bold sm:text-[17px]" : "px-2 py-[3px] text-[10.5px] font-semibold",
        className,
      )}
      style={TONE_STYLE[tone]}
    >
      <span aria-hidden className="font-mono leading-none">
        {TONE_GLYPH[tone]}
      </span>
      {label}
    </span>
  );
}

export function HealthChip({ status, large, className }: { status: HealthStatus; large?: boolean; className?: string }) {
  return <Chip tone={HEALTH_TONE[status]} label={HEALTH_LABEL[status]} large={large} className={className} />;
}

/** A raw JobRun / DatasetRun status. A run left `running` past the stall
 *  threshold died without finishing and is shown as such. */
export function RunStatusChip({ status, stalled }: { status: string; stalled?: boolean }) {
  if (stalled) return <Chip tone="fail" label="未正常結束" />;
  return <Chip tone={RUN_TONE[status] ?? "muted"} label={RUN_STATUS_LABEL[status] ?? status} />;
}

/** Full-width notice above the report: configuration the owner must act on. */
export function Notice({ tone, title, children }: { tone: "warn" | "fail"; title: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className="rd-card flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-[11.5px] leading-[1.6] sm:px-3.5"
      style={tone === "warn" ? { borderColor: "rgba(230,178,58,.55)", background: "rgba(230,178,58,.08)" } : { borderColor: "var(--rd-text)" }}
    >
      <Chip tone={tone} label={title} />
      <span className="min-w-0 flex-1 text-[var(--rd-text-secondary)]">{children}</span>
    </div>
  );
}
