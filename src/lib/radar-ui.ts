// Presentation-layer helpers for the Modernist "Taiwan Industry Radar" design
// (design_handoff_industry_radar/). These translate the REAL numbers already
// computed by src/lib/scoring.ts and src/lib/queries.ts into the Traditional
// Chinese qualitative vocabulary + exact colors the handoff specifies. No
// values are invented here — every input is a real stored/derived number;
// only the label/color chosen for a given number is a presentation choice,
// analogous to how the handoff's own `badge()`/`wc()`/`barC()` helpers work.
import type { IndustryStatus, StockStatus, TechnicalTrend, ValuationPosition } from "@/lib/types";

export interface BadgeStyle {
  label: string;
  bg: string;
  border: string;
  color: string;
}

// Matches the handoff's `badge()` table exactly (README → "Status badges").
export const INDUSTRY_STATUS_BADGE: Record<IndustryStatus, BadgeStyle> = {
  accelerating: { label: "加速中", bg: "rgba(255,86,60,.2)", border: "transparent", color: "#ffc4b8" },
  strengthening: { label: "轉強", bg: "rgba(255,86,60,.11)", border: "transparent", color: "#ff9783" },
  neutral: { label: "中性", bg: "transparent", border: "rgba(243,242,242,.3)", color: "rgba(243,242,242,.65)" },
  weakening: { label: "轉弱", bg: "rgba(61,174,124,.14)", border: "transparent", color: "#6cc79d" },
  overheated: { label: "過熱", bg: "rgba(230,178,58,.16)", border: "transparent", color: "#e6c26a" },
};

export const STOCK_STATUS_BADGE: Record<StockStatus, BadgeStyle> = {
  early_strengthening: { label: "早期轉強", bg: "transparent", border: "rgba(255,86,60,.55)", color: "#ff9783" },
  trend_confirmed: { label: "趨勢確認", bg: "rgba(255,86,60,.11)", border: "transparent", color: "#ff9783" },
  high_level_consolidation: { label: "高檔整理", bg: "transparent", border: "rgba(230,178,58,.5)", color: "#e6c26a" },
  potential_catch_up: { label: "潛在補漲", bg: "transparent", border: "rgba(255,86,60,.55)", color: "#ff9783" },
  overheated: { label: "過熱", bg: "rgba(230,178,58,.16)", border: "transparent", color: "#e6c26a" },
  weakening: { label: "轉弱", bg: "rgba(61,174,124,.14)", border: "transparent", color: "#6cc79d" },
};

export const RISK_LABEL: Record<string, { label: string; color: string }> = {
  high: { label: "高", color: "#e6b23a" },
  medium: { label: "中", color: "rgba(243,242,242,.8)" },
  low: { label: "低", color: "#6cc79d" },
};

export const CYCLE_ZH: Record<string, string> = {
  early: "上升初段",
  expansion: "上升中段",
  peak: "高原期",
  contraction: "下行段",
  trough: "底部盤整",
};

/** Heat bar fill color: tiered by score, with status overrides — matches
 *  the handoff's `barC()`. */
export function heatBarColor(score: number, status: IndustryStatus): string {
  if (status === "overheated") return "#e6b23a";
  if (status === "weakening") return "#3dae7c";
  if (score >= 80) return "#ff563c";
  if (score >= 70) return "rgba(255,86,60,.7)";
  if (score >= 60) return "rgba(255,86,60,.42)";
  return "rgba(243,242,242,.3)";
}

export type TrendGlyph = "↑" | "↗" | "→" | "↘" | "↓";

/** Trend arrow glyph + color from the real week-over-week score delta. */
export function trendFromDelta(delta: number): { glyph: TrendGlyph; color: string } {
  if (delta >= 5) return { glyph: "↑", color: "#ff5a3d" };
  if (delta > 0.5) return { glyph: "↗", color: "#ff5a3d" };
  if (delta >= -0.5) return { glyph: "→", color: "rgba(243,242,242,.6)" };
  if (delta > -5) return { glyph: "↘", color: "#3dae7c" };
  return { glyph: "↓", color: "#3dae7c" };
}

/** Rank delta text (▲n/▼n/—) + color. `delta` = weekAgoRank - todayRank, so a
 *  positive value means the industry climbed the ranking. */
export function rankDeltaText(delta: number): { text: string; color: string } {
  if (delta > 0) return { text: `▲${delta}`, color: "#ff5a3d" };
  if (delta < 0) return { text: `▼${-delta}`, color: "#3dae7c" };
  return { text: "—", color: "rgba(243,242,242,.35)" };
}

/** Qualitative word + Taiwan-convention color for a 0-100 component score —
 *  the same visual language the handoff's `wc()` word-coloring applies to
 *  free-text labels like "強勁流入"/"轉弱", but driven off the real computed
 *  component score rather than seeded copy. */
export function flowWord(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "強勁流入", color: "#ff8a70" };
  if (score >= 55) return { label: "中等流入", color: "#ff8a70" };
  if (score >= 45) return { label: "中性", color: "rgba(243,242,242,.55)" };
  if (score >= 30) return { label: "流出", color: "#6cc79d" };
  return { label: "強力流出", color: "#6cc79d" };
}

/** `null` means the industry has no usable indicator series, so the component
 *  was excluded from its heat score entirely (see compute-scores.ts). It reads
 *  as 無資料 rather than 持平: the two are indistinguishable on the number alone,
 *  and calling an absent series "flat" invents a reading the data never gave. */
export function leadingIndicatorWord(score: number | null): { label: string; color: string } {
  if (score === null) return { label: "無資料", color: "rgba(243,242,242,.4)" };
  if (score >= 60) return { label: "改善中", color: "#ff8a70" };
  if (score >= 45) return { label: "持平", color: "rgba(243,242,242,.55)" };
  return { label: "轉弱", color: "#6cc79d" };
}

export function fundamentalWord(score: number): { label: string; color: string } {
  if (score >= 60) return { label: "改善", color: "#ff8a70" };
  if (score >= 45) return { label: "穩定", color: "rgba(243,242,242,.55)" };
  return { label: "疲弱", color: "#6cc79d" };
}

export function technicalWord(score: number): { label: string; color: string } {
  if (score >= 65) return { label: "強", color: "#ff8a70" };
  if (score >= 45) return { label: "中性", color: "rgba(243,242,242,.55)" };
  return { label: "弱", color: "#6cc79d" };
}

/** Signed 億 (hundred-million NT$) formatter for institutional flow figures
 *  already stored as NT$ thousands (see schema comment on InstitutionalFlow). */
export function yiFlow(ntThousands: number): string {
  const yi = ntThousands / 100_000; // thousands -> 億 (1億 = 100,000 thousand)
  const sign = yi > 0 ? "+" : yi < 0 ? "−" : "";
  return `${sign}${Math.abs(yi).toFixed(1)}`;
}

/**
 * Capital-flow heatmap cell tint (design_handoff README → "Cell tint
 * formula"): alpha = .05 + min(|v|/scale, 1) * .3, red for inflow, green for
 * outflow. The handoff hard-codes a `scale` per column tuned to its
 * fictional data; here `scale` is instead the real max-abs value observed
 * across the column for THIS dataset, so the tint stays meaningful however
 * the underlying numbers are scaled (NT$ thousands, %, etc).
 */
export function tint(value: number, scale: number): { bg: string; color: string } {
  if (!value || scale <= 0) return { bg: "transparent", color: "rgba(243,242,242,.55)" };
  const a = Math.min(Math.abs(value) / scale, 1);
  if (value > 0) return { bg: `rgba(255,86,60,${(0.05 + a * 0.3).toFixed(3)})`, color: a > 0.5 ? "#ffc4b8" : "#ff9783" };
  return { bg: `rgba(61,174,124,${(0.05 + a * 0.3).toFixed(3)})`, color: "#6cc79d" };
}

/** 技術 column word: maps the real computed technical trend onto the
 *  handoff's 多頭/整理/空頭 vocabulary + word coloring. */
export function technicalTrendWord(trend: TechnicalTrend): { label: string; color: string } {
  if (trend === "uptrend" || trend === "breakout") return { label: "多頭", color: "#ff8a70" };
  if (trend === "downtrend" || trend === "breakdown") return { label: "空頭", color: "#6cc79d" };
  return { label: "整理", color: "rgba(243,242,242,.55)" };
}

/** 位階 column word: maps the real computed range-position bucket onto the
 *  handoff's 突破/高檔/中段/低檔 vocabulary. */
export function valuationPositionWord(pos: ValuationPosition): { label: string; color: string } {
  if (pos === "extended") return { label: "突破", color: "#ff8a70" };
  if (pos === "high") return { label: "高檔", color: "rgba(243,242,242,.55)" };
  if (pos === "low") return { label: "低檔", color: "#6cc79d" };
  return { label: "中段", color: "rgba(243,242,242,.55)" };
}

/** 營收動能 accel word from the real month-over-month revenue change. */
export function revenueAccelWord(momChangePct: number | null): { label: string; color: string } {
  if (momChangePct == null) return { label: "—", color: "rgba(243,242,242,.55)" };
  if (momChangePct >= 5) return { label: "加速", color: "#ff8a70" };
  if (momChangePct >= -5) return { label: "穩定", color: "rgba(243,242,242,.55)" };
  return { label: "減速", color: "#6cc79d" };
}

/**
 * Leading-indicator direction badge: real improving/deteriorating/flat flag
 * → the handoff's colored direction chip.
 *
 * `hasData` must be `ind.value != null` at the call site. Most of the
 * indicator taxonomy has never been fetched (licensed data with no free
 * feed — see README "Indicator coverage"), and `improving` collapses that
 * case to the same `null` as a genuinely flat reading. Without `hasData`
 * those 47 empty indicators render "持平", asserting a real unchanged
 * measurement the data never provided.
 */
export function indicatorDirection(improving: boolean | null, hasData: boolean): BadgeStyle {
  if (!hasData) return { label: "無資料", bg: "transparent", border: "rgba(243,242,242,.18)", color: "rgba(243,242,242,.4)" };
  if (improving === true) return { label: "改善中", bg: "rgba(255,86,60,.14)", border: "transparent", color: "#ff9783" };
  if (improving === false) return { label: "惡化中", bg: "rgba(61,174,124,.14)", border: "transparent", color: "#6cc79d" };
  return { label: "持平", bg: "transparent", border: "rgba(243,242,242,.3)", color: "rgba(243,242,242,.65)" };
}

/**
 * Rescales the real relative-strength figure onto the 0-100 scale the
 * handoff's RS column and thresholds (≥85 red / ≤45 green) assume.
 *
 * `classifyStockTechnicals` (src/lib/jobs/compute-scores.ts) computes RS as
 * `100 + 45 * tanh((stockReturn - marketReturn) / 25)`, i.e. centered at 100
 * with a theoretical range of ~55-145 — a different, and reasonable on its
 * own terms, convention (100 = performing in line with the index). Rather
 * than changing that formula (other call sites document and rely on the
 * 100-centered meaning), this is a display-only linear rescale of its known
 * bounds onto 0-100 so the UI's promised scale and color thresholds hold.
 */
export function displayRs(raw: number): number {
  const pct = ((raw - 55) / (145 - 55)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function directionColor(v: number): string {
  if (v > 0) return "#ff5a3d";
  if (v < 0) return "#3dae7c";
  return "rgba(243,242,242,.55)";
}
