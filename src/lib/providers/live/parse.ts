/**
 * Parsing helpers for Taiwan exchange payloads.
 *
 * Every one of these endpoints reports dates in the Minguo (ROC) calendar and
 * numbers as display strings — thousands separators, a leading "+", the "--"
 * placeholder for "no trade today", and an "X" prefix on prices that were not
 * struck by regular matching. Parsing these inline in each provider is how a
 * "--" silently becomes NaN and then a zero close, so it happens here once.
 */

import { utcDay } from "@/lib/dates";

/** ROC year 115 -> 2026. */
const ROC_OFFSET = 1911;

/** Parses "115/08/03" (and "115/8/3") into a UTC-midnight Date. */
export function rocSlashToDate(value: string): Date | null {
  const match = /^\s*(\d{2,3})\/(\d{1,2})\/(\d{1,2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return utcDay(new Date(Date.UTC(Number(y) + ROC_OFFSET, Number(m) - 1, Number(d))));
}

/** Parses the compact "1150824" form used by the OpenAPI feeds. */
export function rocCompactToDate(value: string): Date | null {
  const digits = value.trim();
  if (!/^\d{7}$/.test(digits)) return null;
  const year = Number(digits.slice(0, 3)) + ROC_OFFSET;
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return utcDay(new Date(Date.UTC(year, month - 1, day)));
}

/** Accepts either ROC form and returns whichever parses. */
export function rocToDate(value: string): Date | null {
  return rocCompactToDate(value) ?? rocSlashToDate(value);
}

/** Formats a Date as the "YYYYMMDD" query parameter TWSE expects. */
export function toTwseDateParam(date: Date): string {
  const d = utcDay(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Formats a Date as the "YYYY/MM/DD" query parameter TPEx expects. */
export function toTpexDateParam(date: Date): string {
  const d = utcDay(date);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "11507" -> "2026-07", matching StockFundamental.period for monthly rows. */
export function rocMonthToPeriod(value: string): string | null {
  const digits = value.trim();
  if (!/^\d{5,6}$/.test(digits)) return null;
  // 5 digits = YYYMM, 6 digits = YYYYMM (some feeds pad differently).
  const monthPart = digits.slice(-2);
  const yearPart = digits.slice(0, -2);
  const month = Number(monthPart);
  if (month < 1 || month > 12) return null;
  return `${Number(yearPart) + ROC_OFFSET}-${monthPart}`;
}

/**
 * Parses a display number. Returns null — never NaN and never 0 — for the
 * placeholders these feeds use for "no value", so a caller must decide what
 * absence means rather than silently treating it as zero.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (!text) return null;
  // "--", "---", "－" and "N/A" all mean no trade / not disclosed.
  if (/^(-{2,}|[－—]+|N\/?A)$/i.test(text)) return null;
  // TWSE prefixes prices not struck by regular matching with "X".
  if (/^X/i.test(text)) text = text.slice(1);
  // Some feeds wrap negatives in parentheses.
  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized) text = `-${parenthesized[1]}`;
  text = text.replace(/,/g, "").replace(/^\+/, "").replace(/\s/g, "");
  if (!text || text === "-") return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** parseNumber with an explicit fallback, for fields where absence really
 *  does mean zero (a net flow that was not reported = no net buying). */
export function parseNumberOr(value: unknown, fallback: number): number {
  return parseNumber(value) ?? fallback;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

/**
 * A few radicals carry no NFKC compatibility decomposition, so the fold below
 * cannot find their ideograph on its own. The CJK Radicals Supplement is the
 * gap: only 2 of its 116 codepoints decompose, against 214 of 214 in the
 * Kangxi block. Add entries here as MOPS emits more of them — U+2ED1 turned up
 * in 9933's filing subject.
 */
const RADICAL_TO_IDEOGRAPH: Record<number, string> = {
  0x2ed1: "長", // CJK RADICAL LONG ONE → 長
};

/**
 * Folds a decoded codepoint from either radical block onto the unified
 * ideograph it stands for, and leaves everything else exactly as it arrived.
 *
 * Restricting the fold to the two radical blocks is the point: NFKC over a
 * whole title would also rewrite the full-width punctuation these feeds use
 * deliberately, so only characters that both arrived as a numeric entity and
 * landed in a radical block are touched.
 */
function radicalToIdeograph(code: number): string {
  const explicit = RADICAL_TO_IDEOGRAPH[code];
  if (explicit) return explicit;
  const ch = String.fromCodePoint(code);
  // Kangxi Radicals (U+2F00–U+2FD5) and CJK Radicals Supplement (U+2E80–U+2EF3).
  if ((code >= 0x2f00 && code <= 0x2fd5) || (code >= 0x2e80 && code <= 0x2ef3)) {
    const folded = ch.normalize("NFKC");
    // A radical with neither a decomposition nor a map entry would otherwise
    // ship silently as the wrong character, so make it visible in the log
    // instead of waiting for someone to notice the tofu.
    if (folded === ch) {
      console.warn(
        `[parse] no ideograph known for radical U+${code.toString(16).toUpperCase()}; add it to RADICAL_TO_IDEOGRAPH`,
      );
    }
    return folded;
  }
  return ch;
}

/**
 * Decodes HTML entities in feed text.
 *
 * Needed on the JSON feeds too, not just the HTML pages: MOPS filing subjects
 * arrive with some CJK characters escaped as numeric references. Those
 * references point at the radical-block lookalike rather than the unified
 * ideograph — `&#12070;` is U+2F26 ⼦, not U+5B50 子 — so decoding them literally
 * yields a subject that reads correctly to a human but is built from the wrong
 * characters: a search for "子公司" never matches it, and a font without
 * radical coverage renders tofu mid-sentence. The radicals are therefore
 * folded back onto their ideographs on the way out.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = /^#[xX]/.test(body);
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? radicalToIdeograph(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Extracts the leading integer from strings like "5,013(57)" — the TWSE
 *  breadth table packs "advancers(limit-up)" into one cell. */
export function parseLeadingCount(value: unknown): number | null {
  if (typeof value !== "string") return parseNumber(value);
  const head = value.split("(")[0];
  return parseNumber(head);
}
