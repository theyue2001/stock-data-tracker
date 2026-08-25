// Breakout detection for the Breakout Stock Ratio component of the Industry
// Sentiment Score (spec §2).
//
// Kept deliberately MODULAR: a breakout is whatever the active rule set says
// it is, and rules are small independent predicates over one price series.
// Tightening the definition, or adding e.g. a 60-day-high rule or a
// gap-and-go rule, means adding an entry to DEFAULT_BREAKOUT_RULES — no
// caller, score, or UI changes.

/** One session, newest-first when passed as a series. */
export interface PriceBar {
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface BreakoutContext {
  /** Newest-first price series for one stock. */
  series: PriceBar[];
}

export interface BreakoutRule {
  key: string;
  /** Short Traditional-Chinese label, shown when explaining why a stock counted. */
  label: string;
  description: string;
  /** Returns true when this rule considers today a breakout. */
  test(ctx: BreakoutContext): boolean;
}

const HIGH_LOOKBACK = 20;
const CONSOLIDATION_LOOKBACK = 20;
/** A range is "tight" when its 20-session high sits within this multiple of
 *  its low — a wide, trending range is not a consolidation to break out of. */
const CONSOLIDATION_TIGHTNESS = 1.12;
const VOLUME_LOOKBACK = 20;
const VOLUME_EXPANSION_MULTIPLE = 1.5;

/** Close above the highest high of the prior 20 sessions (today excluded). */
export const above20DayHigh: BreakoutRule = {
  key: "above_20d_high",
  label: "突破 20 日高",
  description: "Close above the highest high of the previous 20 sessions.",
  test: ({ series }) => {
    if (series.length < HIGH_LOOKBACK + 1) return false;
    const prior = series.slice(1, HIGH_LOOKBACK + 1);
    return series[0].close > Math.max(...prior.map((b) => b.high));
  },
};

/**
 * Break above a tight consolidation range. Distinct from the 20-day-high
 * rule: a stock grinding up every day makes new 20-day highs continuously
 * without ever having consolidated, while this rule only fires when a
 * genuinely flat base is resolved upward.
 */
export const consolidationBreak: BreakoutRule = {
  key: "consolidation_break",
  label: "突破盤整區",
  description: "Close above a tight (≤12% wide) 20-session consolidation range.",
  test: ({ series }) => {
    if (series.length < CONSOLIDATION_LOOKBACK + 1) return false;
    const prior = series.slice(1, CONSOLIDATION_LOOKBACK + 1);
    const high = Math.max(...prior.map((b) => b.high));
    const low = Math.min(...prior.map((b) => b.low));
    if (low <= 0 || high / low > CONSOLIDATION_TIGHTNESS) return false;
    return series[0].close > high;
  },
};

/**
 * Volume expansion at the same time as an up close. On its own this is
 * confirmation rather than a breakout, which is why it is combined with the
 * price rules by `detectBreakout` rather than being able to qualify alone.
 */
export const volumeConfirmation: BreakoutRule = {
  key: "volume_confirmation",
  label: "帶量上攻",
  description: "Up close on ≥1.5× the trailing 20-session average volume.",
  test: ({ series }) => {
    if (series.length < VOLUME_LOOKBACK + 1) return false;
    const [today, ...prior] = series;
    const window = prior.slice(0, VOLUME_LOOKBACK);
    const avg = window.reduce((sum, b) => sum + b.volume, 0) / window.length;
    if (avg <= 0) return false;
    const up = today.close > prior[0].close;
    return up && today.volume >= avg * VOLUME_EXPANSION_MULTIPLE;
  },
};

/** Price rules can qualify a stock on their own. */
export const DEFAULT_BREAKOUT_RULES: BreakoutRule[] = [above20DayHigh, consolidationBreak];

/** Confirmation rules can only strengthen a price breakout, never create one. */
export const DEFAULT_CONFIRMATION_RULES: BreakoutRule[] = [volumeConfirmation];

export interface BreakoutResult {
  isBreakout: boolean;
  /** Keys of every rule that fired, price and confirmation alike. */
  triggered: string[];
  /** True when a price breakout was accompanied by volume expansion — the
   *  higher-quality case spec §2 asks for ("volume expansion at the same
   *  time"). Reported separately rather than being required, so a quiet
   *  breakout still counts toward breadth. */
  volumeConfirmed: boolean;
}

/**
 * Evaluates one stock's series. A stock counts as a breakout when ANY price
 * rule fires; confirmation rules are recorded but cannot qualify a stock on
 * their own.
 */
export function detectBreakout(
  series: PriceBar[],
  priceRules: BreakoutRule[] = DEFAULT_BREAKOUT_RULES,
  confirmationRules: BreakoutRule[] = DEFAULT_CONFIRMATION_RULES,
): BreakoutResult {
  const ctx: BreakoutContext = { series };
  const priceHits = priceRules.filter((r) => r.test(ctx));
  const confirmHits = confirmationRules.filter((r) => r.test(ctx));

  return {
    isBreakout: priceHits.length > 0,
    triggered: [...priceHits, ...confirmHits].map((r) => r.key),
    volumeConfirmed: priceHits.length > 0 && confirmHits.length > 0,
  };
}
