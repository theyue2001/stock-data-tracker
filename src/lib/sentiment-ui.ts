// Presentation-layer helpers for the 產業氣氛 / Industry Momentum module.
//
// Same contract as src/lib/radar-ui.ts: no value is invented here — every
// input is a real stored/derived number, and only the LABEL and COLOR chosen
// for a given number are presentation choices. Reuses the exact Modernist
// tokens the rest of the app already uses so the module reads as part of the
// existing system rather than a new one.
//
// Taiwan convention throughout: 紅 = up/positive, 綠 = down/negative.
import type { BadgeStyle } from "@/lib/radar-ui";
import type { SentimentHeatQuadrant } from "@/lib/sentiment";
import type { SentimentStatus } from "@/lib/types";

/**
 * Status badges for the nine sentiment labels (spec §6).
 *
 * 短線過熱 is amber, NOT green: the spec is explicit that overheated is not
 * a bearish label, so it must not borrow the down-colour. It shares the amber
 * treatment the heat score already uses for its own 過熱 badge.
 * 加速轉強 is the strongest red because acceleration is what the module exists
 * to surface (spec §13).
 */
export const SENTIMENT_STATUS_BADGE: Record<SentimentStatus, BadgeStyle> = {
  accelerating: { label: "加速轉強", bg: "rgba(255,86,60,.24)", border: "transparent", color: "#ffc4b8" },
  strong_cluster: { label: "強勢群聚", bg: "rgba(255,86,60,.18)", border: "transparent", color: "#ff9783" },
  bullish: { label: "多方", bg: "rgba(255,86,60,.11)", border: "transparent", color: "#ff9783" },
  mild_bullish: { label: "中性偏多", bg: "transparent", border: "rgba(255,86,60,.45)", color: "#ff8a70" },
  neutral: { label: "中性", bg: "transparent", border: "rgba(243,242,242,.3)", color: "rgba(243,242,242,.65)" },
  mild_bearish: { label: "中性偏空", bg: "transparent", border: "rgba(61,174,124,.45)", color: "#6cc79d" },
  weakening: { label: "轉弱", bg: "rgba(61,174,124,.14)", border: "transparent", color: "#6cc79d" },
  weak_cluster: { label: "弱勢群聚", bg: "rgba(61,174,124,.2)", border: "transparent", color: "#8ed4b4" },
  overheated: { label: "短線過熱", bg: "rgba(230,178,58,.16)", border: "transparent", color: "#e6c26a" },
};

/** Sentiment bar fill: tiered by score, with the two status overrides that
 *  carry their own meaning. Mirrors heatBarColor() so the two bars are
 *  visually consistent while remaining separate readings. */
export function sentimentBarColor(score: number, status: SentimentStatus): string {
  if (status === "overheated") return "#e6b23a";
  if (status === "weakening" || status === "weak_cluster") return "#3dae7c";
  if (score >= 80) return "#ff563c";
  if (score >= 65) return "rgba(255,86,60,.7)";
  if (score >= 52) return "rgba(255,86,60,.42)";
  if (score >= 40) return "rgba(243,242,242,.3)";
  return "rgba(61,174,124,.45)";
}

/** Score text colour on the 0-100 sentiment scale, centred at 50. */
export function sentimentTextColor(score: number): string {
  if (score >= 70) return "#ff5a3d";
  if (score >= 55) return "#ff8a70";
  if (score >= 45) return "#f3f2f2";
  if (score >= 30) return "#6cc79d";
  return "#3dae7c";
}

/** "#9 → #1" plus the signed jump. `delta` = previousRank − rank, so a
 *  positive value means the group climbed. */
export function rankChangeText(
  rank: number,
  previousRank: number | null,
  delta: number,
): { path: string; jump: string; color: string; emphasis: boolean } {
  if (previousRank === null) {
    return { path: `#${rank}`, jump: "新進榜", color: "rgba(243,242,242,.5)", emphasis: false };
  }
  const path = `#${previousRank} → #${rank}`;
  if (delta > 0) return { path, jump: `↑${delta}`, color: "#ff5a3d", emphasis: delta >= 4 };
  if (delta < 0) return { path, jump: `↓${-delta}`, color: "#3dae7c", emphasis: delta <= -4 };
  return { path, jump: "—", color: "rgba(243,242,242,.35)", emphasis: false };
}

/** Volume-expansion word for the 量能 column, from the real ratio. */
export function volumeWord(ratio: number): { label: string; color: string } {
  const text = `${ratio.toFixed(1)}x`;
  if (ratio >= 1.8) return { label: text, color: "#ff5a3d" };
  if (ratio >= 1.25) return { label: text, color: "#ff8a70" };
  if (ratio >= 0.8) return { label: text, color: "rgba(243,242,242,.6)" };
  return { label: text, color: "#6cc79d" };
}

/**
 * 法人 column word. Names the dominant participant rather than dumping three
 * numbers into a table cell, and only claims a side when the net figure is
 * actually on that side. Dealer flow is reported only when it is the sole
 * active participant, matching the half-weight the score gives it.
 *
 * A zero net reads "—", which means a genuinely balanced session and nothing
 * else. Callers MUST gate on `flowSource !== "none"` before calling: a group
 * with no print stores its nets as 0 and would otherwise land here, making
 * "no report" and "the buying netted out" indistinguishable.
 */
export function institutionWord(
  foreignNet: number,
  trustNet: number,
  dealerNet: number,
): { label: string; color: string } {
  const net = foreignNet + trustNet + dealerNet * 0.5;
  if (net === 0) return { label: "—", color: "rgba(243,242,242,.4)" };

  const positive = net > 0;
  const color = positive ? "#ff8a70" : "#6cc79d";
  const verb = positive ? "買超" : "賣超";

  const both = positive ? foreignNet > 0 && trustNet > 0 : foreignNet < 0 && trustNet < 0;
  if (both) return { label: `外資+投信${verb}`, color };

  const candidates: Array<{ name: string; value: number }> = [
    { name: "外資", value: foreignNet },
    { name: "投信", value: trustNet },
    { name: "自營", value: dealerNet },
  ].filter((c) => (positive ? c.value > 0 : c.value < 0));

  if (!candidates.length) return { label: verb, color };
  const dominant = candidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return { label: `${dominant.name}${verb}`, color };
}

/** Flow-provenance note — an apportioned figure must never read like a
 *  measured print (spec §11), and a missing one must never read like a
 *  balanced session. Used by both the 細產業 tab and the industry rows, so the
 *  "none" wording is not scoped to sub-industries. */
export const FLOW_SOURCE_NOTE: Record<string, { label: string; title: string } | null> = {
  industry: null,
  stock: null,
  prorated: { label: "推估", title: "此細產業無獨立法人數據，依成交值比例由母產業分攤推估。" },
  none: { label: "無資料", title: "本日無法人買賣超資料，此分項未計入加權。" },
};

/** Sentiment-vs-Heat quadrant (spec §10 Case A-D). Descriptive only — the
 *  module deliberately issues no buy/sell signal. */
export const QUADRANT_META: Record<SentimentHeatQuadrant, { label: string; note: string; color: string }> = {
  mainstream: { label: "主流趨勢", note: "短線氣氛與中期熱度同步，具基本面支撐", color: "#ff8a70" },
  speculative: { label: "題材急拉", note: "短線氣氛高於中期熱度，偏題材帶動", color: "#e6c26a" },
  consolidating: { label: "高檔休息", note: "中期熱度仍高但短線氣氛降溫", color: "rgba(243,242,242,.7)" },
  low_priority: { label: "低度關注", note: "短線與中期皆偏弱", color: "#6cc79d" },
};

/** Day-over-day sentiment trend arrow. Thresholds are tighter than
 *  radar-ui's trendFromDelta() because that one measures a WEEK of heat-score
 *  drift while this measures a SINGLE session of sentiment change. */
export function sentimentTrendGlyph(delta: number): { glyph: string; color: string } {
  if (delta >= 8) return { glyph: "↑", color: "#ff5a3d" };
  if (delta > 1) return { glyph: "↗", color: "#ff5a3d" };
  if (delta >= -1) return { glyph: "→", color: "rgba(243,242,242,.6)" };
  if (delta > -8) return { glyph: "↘", color: "#3dae7c" };
  return { glyph: "↓", color: "#3dae7c" };
}
