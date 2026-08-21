import type {
  Importance,
  IndustryStatus,
  RiskLevel,
  StockStatus,
  TechnicalTrend,
  ValuationPosition,
} from "@/lib/types";

/** Taiwan market convention: red = up, green = down. */
export function directionClass(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-muted-foreground";
}

export function signed(v: number, digits = 2): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

export function pct(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** Institutional flow is stored in NT$ thousands. */
export function ntFlow(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}B`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}M`;
  return `${sign}${abs.toFixed(0)}K`;
}

export const INDUSTRY_STATUS_META: Record<IndustryStatus, { label: string; className: string }> = {
  accelerating: { label: "Accelerating", className: "bg-up/20 text-up border-up/40" },
  strengthening: { label: "Strengthening", className: "bg-heat-warm/15 text-heat-warm border-heat-warm/35" },
  neutral: { label: "Neutral", className: "bg-muted text-muted-foreground border-border" },
  weakening: { label: "Weakening", className: "bg-down/15 text-down border-down/35" },
  overheated: { label: "Overheated", className: "bg-heat-hot/25 text-heat-hot border-heat-hot/50" },
};

export const STOCK_STATUS_META: Record<StockStatus, { label: string; className: string }> = {
  early_strengthening: { label: "Early Strengthening", className: "bg-heat-warm/15 text-heat-warm border-heat-warm/35" },
  trend_confirmed: { label: "Trend Confirmed", className: "bg-up/20 text-up border-up/40" },
  high_level_consolidation: { label: "High-Level Consolidation", className: "bg-muted text-muted-foreground border-border" },
  potential_catch_up: { label: "Potential Catch-Up", className: "bg-chart-1/20 text-chart-1 border-chart-1/40" },
  overheated: { label: "Overheated", className: "bg-heat-hot/25 text-heat-hot border-heat-hot/50" },
  weakening: { label: "Weakening", className: "bg-down/15 text-down border-down/35" },
};

export const TECHNICAL_TREND_META: Record<TechnicalTrend, { label: string; className: string }> = {
  breakout: { label: "Breakout", className: "text-up" },
  uptrend: { label: "Uptrend", className: "text-up/80" },
  neutral: { label: "Neutral", className: "text-muted-foreground" },
  downtrend: { label: "Downtrend", className: "text-down/80" },
  breakdown: { label: "Breakdown", className: "text-down" },
};

export const VALUATION_META: Record<ValuationPosition, { label: string; className: string }> = {
  low: { label: "Low in range", className: "text-chart-1" },
  mid_range: { label: "Mid range", className: "text-muted-foreground" },
  high: { label: "High in range", className: "text-heat-warm" },
  extended: { label: "Extended", className: "text-heat-hot" },
};

export const RISK_META: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Low risk", className: "bg-down/15 text-down border-down/30" },
  medium: { label: "Medium risk", className: "bg-heat-neutral/15 text-heat-neutral border-heat-neutral/30" },
  high: { label: "High risk", className: "bg-heat-hot/20 text-heat-hot border-heat-hot/40" },
};

export const IMPORTANCE_META: Record<Importance, { label: string; className: string }> = {
  high: { label: "High", className: "bg-heat-hot/20 text-heat-hot border-heat-hot/40" },
  medium: { label: "Medium", className: "bg-heat-warm/15 text-heat-warm border-heat-warm/35" },
  low: { label: "Low", className: "bg-muted text-muted-foreground border-border" },
};

export const CYCLE_LABEL: Record<string, string> = {
  early: "Early cycle",
  expansion: "Expansion",
  peak: "Peak",
  contraction: "Contraction",
  trough: "Trough",
};

/** Maps a 0-100 heat score onto the five-step heat ramp. */
export function heatColor(score: number): string {
  if (score >= 80) return "var(--heat-hot)";
  if (score >= 65) return "var(--heat-warm)";
  if (score >= 50) return "var(--heat-neutral)";
  if (score >= 35) return "var(--heat-cool)";
  return "var(--heat-cold)";
}

export function heatTextClass(score: number): string {
  if (score >= 80) return "text-heat-hot";
  if (score >= 65) return "text-heat-warm";
  if (score >= 50) return "text-heat-neutral";
  if (score >= 35) return "text-heat-cool";
  return "text-heat-cold";
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}
