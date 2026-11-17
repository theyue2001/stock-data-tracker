import { fetchJsonOptional } from "@/lib/providers/live/http";
import {
  dayString,
  fieldIndex,
  parseLeadingCount,
  parseNumber,
  rocCompactToDate,
  rocSlashToDate,
  sameDay,
  toTwseDateParam,
  twseHasNoData,
  twseTitleDate,
} from "@/lib/providers/live/parse";
import { NotPublishedError } from "@/lib/providers/errors";
import type { MarketStatusProvider, MarketStatusResult, ProviderSource } from "@/lib/providers/types";
import { taipeiNow } from "@/lib/market-session";
import { utcDay } from "@/lib/dates";

/**
 * Market-wide TAIEX status: index level, turnover, advance/decline breadth,
 * market-level institutional net buying, and the change in total margin
 * financing.
 *
 * Assembled from four separate TWSE reports rather than approximated from the
 * 55 tracked stocks. Breadth over a hand-picked watchlist is not market
 * breadth, and relative strength measured against a synthetic index is not
 * relative strength — both feed the scores directly.
 *
 * The four reports differ enormously in cost, and the split below is the whole
 * reason this class has the shape it does:
 *
 *  - FMTQIK carries index close, point change and volume for a WHOLE MONTH in
 *    one request. Nine requests cover a year.
 *  - Breadth, institutional flow and margin are published per session, so
 *    covering the same year costs ~750 requests to a host that IP-blocks a
 *    client for sustained iteration over one report path.
 *
 * So the cheap leg (`fetchSessions`) and the expensive leg
 * (`fetchSessionDetail`) are separate entry points, and the caller decides how
 * far back it is worth paying for detail. `fetchRange` keeps the
 * MarketStatusProvider contract by combining them over a bounded window.
 *
 * This module also owns `latestSessionDate()`, the answer to "which session
 * has the exchange actually published" that the prices and flows providers
 * and the pipeline gate all resolve against — see `createSessionResolver`.
 */

const FMTQIK = "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK";
const MI_INDEX = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";
const BFI82U = "https://www.twse.com.tw/rwd/zh/fund/BFI82U";
const MI_MARGN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TWSE_SNAPSHOT_DATE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";

export interface TwseTableResponse {
  stat?: string;
  title?: string;
  date?: string;
  fields?: string[];
  data?: string[][];
  tables?: Array<{ title?: string; fields?: string[]; data?: string[][]; groups?: Array<{ title?: string }> }>;
}

/** The cheap leg: index level, point change and turnover for one session. */
export interface SessionCore {
  date: Date;
  close: number;
  change: number;
  /**
   * Market turnover in NT$ (成交金額) — NOT share count.
   *
   * `MarketStatus.volume` and `MarketData.volume` are the same column name with
   * different units, which is a trap worth spelling out: per-stock volume is
   * shares, because the volume-expansion ratio compares a stock against its own
   * trailing share volume, while the market figure is currency, because the UI
   * renders it as 成交金額 in 億 (`raw / 1e8`). Feeding 成交股數 here yields a
   * plausible-looking number roughly 50x too small.
   */
  volume: number;
}

/** The expensive leg: everything published per session. */
export interface SessionDetail {
  breadthAdvancers: number | null;
  breadthDecliners: number | null;
  foreignNet: number | null;
  trustNet: number | null;
  dealerNet: number | null;
  marginChange: number | null;
}

const EMPTY_DETAIL: SessionDetail = {
  breadthAdvancers: null,
  breadthDecliners: null,
  foreignNet: null,
  trustNet: null,
  dealerNet: null,
  marginChange: null,
};

export class TwseMarketStatusProvider implements MarketStatusProvider {
  readonly source: ProviderSource = {
    key: "twse-market-status",
    name: "TWSE Market Statistics (TAIEX)",
    category: "market_data",
    url: "https://www.twse.com.tw/zh/trading/historical/fmtqik.html",
    isMock: false,
    description:
      "TAIEX close and turnover (FMTQIK), advance/decline breadth (MI_INDEX), market-level three-institution net buying (BFI82U), and total margin financing balance (MI_MARGN).",
  };

  async fetchLatest(): Promise<MarketStatusResult[]> {
    const published = await requirePublishedSession();
    // When the date came from FMTQIK the resolver already holds that row, and
    // asking FMTQIK again would be a second hit on the throttled host for the
    // same bytes. Only the mirror fallback has to fetch it.
    const core =
      published.core ??
      (await this.fetchSessions(published.date, published.date)).find((s) => sameDay(s.date, published.date));
    if (!core) throw new NotPublishedError("TWSE FMTQIK", dayString(published.date));
    return [toResult(core, await this.fetchSessionDetail(core.date))];
  }

  /** Contract-satisfying combination of both legs. Only use over a short
   *  window; the backfill drives the two legs separately so it can pay for
   *  detail over a narrower range than it pays for prices. */
  async fetchRange(from: Date, to: Date): Promise<MarketStatusResult[]> {
    const sessions = await this.fetchSessions(from, to);
    const results: MarketStatusResult[] = [];
    for (const session of sessions) {
      results.push(toResult(session, await this.fetchSessionDetail(session.date)));
    }
    return results;
  }

  /**
   * Index close, point change and turnover for every session in the range.
   * One request per calendar month, which is why the full history is affordable
   * even when per-session detail is not.
   */
  async fetchSessions(from: Date, to: Date): Promise<SessionCore[]> {
    const out: SessionCore[] = [];
    const fromDay = utcDay(from).getTime();
    const toDay = utcDay(to).getTime();

    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cursor.getTime() <= end.getTime()) {
      const payload = await fetchJsonOptional<TwseTableResponse>(
        `${FMTQIK}?date=${toTwseDateParam(cursor)}&response=json`,
      );
      for (const session of parseFmtqik(payload)) {
        const time = session.date.getTime();
        if (time >= fromDay && time <= toDay) out.push(session);
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out;
  }

  /**
   * Breadth, market-level institutional net buying and margin change for one
   * session — three requests to the rate-limited host.
   *
   * Every field is independently nullable, and a field whose report is not
   * published for this session yet stays null rather than defaulting to zero.
   * Zero is a real reading here ("no net foreign buying", "no stocks
   * advanced") and inventing it would be indistinguishable from having
   * measured it. The three reports publish at different times on the session
   * day — at 16:36 on 2026-11-17 breadth and BFI82U were out and MI_MARGN was
   * still empty — so an afternoon run gets a row with margin still null.
   *
   * The Promise.all buys no concurrency, and no future edit here can: http.ts
   * serializes every www.twse.com.tw request through one per-host queue, so
   * these three cost three throttle intervals however they are written. It
   * stays because it reads as one unit of work — but the only way to spend
   * less on this leg is to ask for fewer sessions, not to fire more requests
   * at once.
   */
  async fetchSessionDetail(date: Date): Promise<SessionDetail> {
    const day = toTwseDateParam(date);
    const [breadthPayload, institutionalPayload, marginPayload] = await Promise.all([
      fetchJsonOptional<TwseTableResponse>(`${MI_INDEX}?date=${day}&type=MS&response=json`),
      fetchJsonOptional<TwseTableResponse>(`${BFI82U}?dayDate=${day}&type=day&response=json`),
      fetchJsonOptional<TwseTableResponse>(`${MI_MARGN}?date=${day}&selectType=ALL&response=json`),
    ]);

    const breadth = parseBreadth(breadthPayload, date);
    const institutional = parseInstitutional(institutionalPayload, date);
    return {
      breadthAdvancers: breadth?.advancers ?? null,
      breadthDecliners: breadth?.decliners ?? null,
      foreignNet: institutional?.foreignNet ?? null,
      trustNet: institutional?.trustNet ?? null,
      dealerNet: institutional?.dealerNet ?? null,
      marginChange: parseMarginChange(marginPayload, date),
    };
  }
}

/** Combines the two legs into the row shape the writer expects. */
export function toResult(session: SessionCore, detail: SessionDetail = EMPTY_DETAIL): MarketStatusResult {
  const priorClose = session.close - session.change;
  return {
    date: session.date,
    index: "TAIEX",
    close: session.close,
    change: session.change,
    changePct: priorClose > 0 ? (session.change / priorClose) * 100 : 0,
    volume: session.volume,
    ...detail,
  };
}

// ---------------------------------------------------------------------------
// Report parsers. Pure, so the decisions they make are testable against saved
// responses (see __fixtures__).
// ---------------------------------------------------------------------------

/**
 * Every session row in an FMTQIK month, oldest first.
 *
 * A row missing its close, point change or turnover is dropped rather than
 * zero-filled: a market row with an invented change or turnover would read as
 * a flat, empty session.
 */
export function parseFmtqik(payload: TwseTableResponse | null): SessionCore[] {
  if (!payload || payload.stat !== "OK" || !payload.data) return [];
  const dateCol = fieldIndex("FMTQIK", payload.fields, "日期");
  // 成交金額, not 成交股數 — see SessionCore.volume.
  const valueCol = fieldIndex("FMTQIK", payload.fields, "成交金額");
  const closeCol = fieldIndex("FMTQIK", payload.fields, "發行量加權股價指數");
  const changeCol = fieldIndex("FMTQIK", payload.fields, "漲跌點數");

  const out: SessionCore[] = [];
  for (const row of payload.data) {
    const date = rocSlashToDate(row[dateCol] ?? "");
    const close = parseNumber(row[closeCol]);
    const change = parseNumber(row[changeCol]);
    const volume = parseNumber(row[valueCol]);
    if (!date || close === null || change === null || volume === null) continue;
    out.push({ date, close, change, volume });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Whether a per-session detail report describes `session`, judged by the date
 * in its own titles. A report for another session is discarded (the field
 * stays null) rather than stored under the wrong date.
 */
function detailIsFor(report: string, payload: TwseTableResponse, session: Date): boolean {
  const carried = twseTitleDate(payload);
  if (carried && sameDay(carried, session)) return true;
  console.warn(
    `[market-status] ${report} for ${dayString(session)} ${carried ? `carries ${dayString(carried)}` : "has no dated title"}; field left null`,
  );
  return false;
}

/** Advancers / decliners among listed STOCKS (MI_INDEX type=MS), or null when
 *  the report is not published for `session`. */
export function parseBreadth(
  payload: TwseTableResponse | null,
  session: Date,
): { advancers: number; decliners: number } | null {
  if (!payload || payload.stat !== "OK") return null;
  if (!detailIsFor("MI_INDEX MS", payload, session)) return null;
  const table = payload.tables?.find((t) => t?.title?.includes("漲跌證券數"));
  if (!table?.data) return null;

  // Columns are [類型, 整體市場, 股票]. The 股票 column is the one that means
  // anything here — 整體市場 is dominated by warrants, which swamp the count
  // and make breadth read as permanently negative.
  const stocks = (table.fields ?? []).indexOf("股票");
  if (stocks < 0) return null;
  const pick = (label: string) => {
    const row = table.data?.find((r) => String(r[0] ?? "").startsWith(label));
    return row ? parseLeadingCount(row[stocks]) : null;
  };
  const advancers = pick("上漲");
  const decliners = pick("下跌");
  if (advancers === null || decliners === null) return null;
  return { advancers, decliners };
}

/**
 * Market-level net buying in NT$ thousands (BFI82U), or null when the report
 * is not published for `session`. Each figure is independently null when its
 * rows are missing — a name TWSE renames must not quietly sum to zero.
 */
export function parseInstitutional(
  payload: TwseTableResponse | null,
  session: Date,
): { foreignNet: number | null; trustNet: number | null; dealerNet: number | null } | null {
  if (!payload || payload.stat !== "OK" || !payload.data?.length) return null;
  if (!detailIsFor("BFI82U", payload, session)) return null;
  const netColumn = (payload.fields ?? []).indexOf("買賣差額");
  if (netColumn < 0) return null;

  // Rows are 單位名稱 / 買進金額 / 賣出金額 / 買賣差額, all in NT$. The six names
  // are 自營商(自行買賣), 自營商(避險), 投信, 外資及陸資(不含外資自營商), 外資自營商
  // and 合計.
  //
  // Each predicate is anchored at the start of the name, and the cell is
  // trimmed because startsWith is whitespace-sensitive where includes was
  // not. The anchoring is the load-bearing part: TWSE spells the main foreign
  // row 外資及陸資(不含外資自營商), so an unanchored includes("自營商") matches
  // that parenthetical disclaimer as well and folds the whole foreign net
  // into the dealer figure on every single session.
  const net = (predicate: (name: string) => boolean): number | null => {
    const rows = (payload.data ?? []).filter((r) => predicate(String(r[0] ?? "").trim()));
    if (!rows.length) return null;
    let sum = 0;
    for (const row of rows) {
      const value = parseNumber(row[netColumn]);
      if (value === null) return null;
      sum += value;
    }
    return sum / 1000;
  };

  return {
    // Foreign keeps the foreign-dealer book (外資自營商), the way the
    // per-stock feed is summed in flow-provider.ts (外陸資不含外資自營商 +
    // 外資自營商). TWSE's footnote on this report says that amount is
    // already counted inside the 自營商 rows, which is why its own 合計
    // leaves it out separately; it has been zero on every session probed, so
    // if it ever goes non-zero both feeds have to be revisited together
    // rather than only this one.
    foreignNet: net((n) => n.startsWith("外資")),
    trustNet: net((n) => n.startsWith("投信")),
    // 自營商(自行買賣) + 自營商(避險) only: 外資自營商 does not start
    // with 自營商. Anchored this way the three fields reconcile exactly to
    // the report's own 合計 row, which is the check that says the split is
    // the one TWSE itself uses.
    dealerNet: net((n) => n.startsWith("自營商")),
  };
}

/** Change in the total margin financing balance in NT$ thousands (MI_MARGN
 *  信用交易統計), or null when the report is not published for `session`. */
export function parseMarginChange(payload: TwseTableResponse | null, session: Date): number | null {
  if (!payload || payload.stat !== "OK") return null;
  if (!detailIsFor("MI_MARGN", payload, session)) return null;
  const table = payload.tables?.find((t) => t?.title?.includes("信用交易統計"));
  const row = table?.data?.find((r) => String(r[0] ?? "").startsWith("融資金額"));
  if (!table || !row) return null;

  // 項目, 買進, 賣出, 現金(券)償還, 前日餘額, 今日餘額 — already in 仟元.
  const prior = parseNumber(row[(table.fields ?? []).indexOf("前日餘額")]);
  const today = parseNumber(row[(table.fields ?? []).indexOf("今日餘額")]);
  if (prior === null || today === null) return null;
  return today - prior;
}

// ---------------------------------------------------------------------------
// Which session has been published
// ---------------------------------------------------------------------------

/** A session whose after-hours whole-market close is out. */
export interface PublishedSession {
  /** UTC-midnight storage key of the session. */
  date: Date;
  /** Which source named it — "openapi-mirror" means FMTQIK could not be asked. */
  via: "fmtqik" | "openapi-mirror";
  /** FMTQIK's own row for `date`, when that is where the date came from. */
  core: SessionCore | null;
}

export interface SessionResolverDeps {
  /** FMTQIK for the Taipei month containing `now`. Null means HTTP 404. */
  fetchFmtqik(now: Date): Promise<TwseTableResponse | null>;
  /** The session the openapi STOCK_DAY_ALL mirror currently carries. */
  fetchMirrorDate(): Promise<Date | null>;
  now(): Date;
  warn(message: string): void;
}

/**
 * How long one answer is reused. Shorter than the pipeline's 5-minute poll, so
 * every poll asks afresh, and longer than one pipeline run, so the gate, the
 * TAIEX row, the prices and the flows of a single run all resolve the SAME
 * session with one request between them — a run straddling the moment FMTQIK
 * flips to the new session must not store prices for one session and flows
 * for another.
 */
export const SESSION_MEMO_TTL_MS = 4 * 60 * 1000;

/**
 * Resolves the newest session whose after-hours close is published.
 *
 * FMTQIK on the interactive host is asked first: it carries the session's
 * TAIEX row from the afternoon of the session day (observed current at 16:06
 * and 16:36 on 2026-11-17). Every openapi.twse.com.tw report is regenerated
 * in TWSE's nightly batch instead — on 2026-11-17 at 16:35 STOCK_DAY_ALL,
 * FMTQIK, MI_INDEX and MI_MARGN on that host all still carried 11-16, with
 * Last-Modified 05:20–05:24 Taipei — so resolving from the mirror alone (as
 * this used to) leaves session D unseen until the morning of D+1, and the
 * pipeline gate skips all evening believing D-1 is the newest session.
 *
 * Cost: exactly one www.twse.com.tw request per memo period, never retried.
 * The mirror is only asked when FMTQIK fails, is blocked, or has no session
 * yet for the current month (the first trading day of a month, before
 * publication) — and since it only ever carries published sessions it is a
 * safe, merely late, answer.
 */
export function createSessionResolver(deps: SessionResolverDeps, ttlMs: number = SESSION_MEMO_TTL_MS) {
  let memo: { at: number; value: Promise<PublishedSession | null> } | null = null;

  async function fromMirror(): Promise<PublishedSession | null> {
    try {
      const date = await deps.fetchMirrorDate();
      return date ? { date: utcDay(date), via: "openapi-mirror", core: null } : null;
    } catch (error) {
      deps.warn(`[session] openapi mirror unavailable too: ${(error as Error).message}`);
      return null;
    }
  }

  async function resolveOnce(now: Date): Promise<PublishedSession | null> {
    let payload: TwseTableResponse | null;
    try {
      payload = await deps.fetchFmtqik(now);
      if (!payload) throw new Error("HTTP 404");
    } catch (error) {
      deps.warn(
        `[session] FMTQIK unavailable (${(error as Error).message}); falling back to the openapi mirror, which lags the session day until ~05:20 the next morning`,
      );
      return fromMirror();
    }

    if (payload.stat !== "OK" && !twseHasNoData(payload)) {
      deps.warn(`[session] FMTQIK answered "${payload.stat}"; falling back to the openapi mirror`);
      return fromMirror();
    }
    const newest = parseFmtqik(payload).at(-1);
    if (newest) return { date: newest.date, via: "fmtqik", core: newest };
    // A month with no published session yet: the newest one is last month's,
    // which is exactly what the mirror carries at that point.
    return fromMirror();
  }

  return {
    resolve(): Promise<PublishedSession | null> {
      const now = deps.now();
      if (memo && now.getTime() - memo.at < ttlMs) return memo.value;
      // The promise itself is memoized, so concurrent callers share one
      // request instead of each starting their own.
      const value = resolveOnce(now);
      memo = { at: now.getTime(), value };
      return value;
    },
  };
}

/** Per-request timeout for the gate's FMTQIK call: it is ~1.4 KB. */
const SESSION_REQUEST_TIMEOUT_MS = 10_000;
/**
 * Overall wait before falling back to the mirror. Needed on top of the
 * request timeout because http.ts answers a block by sleeping out a 180 s
 * cooldown inside the request before it throws, even with retries: 0 — the
 * gate would otherwise stall three minutes on a blocked host.
 */
const SESSION_DEADLINE_MS = 30_000;

/** FMTQIK for the TAIPEI month containing `now` — a runtime in UTC would ask
 *  for last month's report from 00:00 to 08:00 Taipei on the 1st. */
export function sessionProbeUrl(now: Date): string {
  return `${FMTQIK}?date=${taipeiNow(now).date.replace(/-/g, "")}&response=json`;
}

function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  // The abandoned request keeps running in http.ts's host queue; swallow its
  // eventual rejection so it cannot surface as an unhandled rejection after
  // the race has moved on.
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const publishedSession = createSessionResolver({
  fetchFmtqik: (now) =>
    withDeadline(
      fetchJsonOptional<TwseTableResponse>(sessionProbeUrl(now), {
        // Fresh on every memo period: http.ts would otherwise hand a
        // long-running scheduler a cached month.
        noCache: true,
        retries: 0,
        timeoutMs: SESSION_REQUEST_TIMEOUT_MS,
        // A block page falls back to the mirror now rather than holding the
        // host queue for the 3-minute cooldown; the next poll retries.
        blockCooldown: false,
      }),
      SESSION_DEADLINE_MS,
      `no answer within ${SESSION_DEADLINE_MS / 1000}s`,
    ),
  fetchMirrorDate: async () => {
    const rows = await fetchJsonOptional<Array<{ Date?: string }>>(TWSE_SNAPSHOT_DATE);
    const stamp = rows?.[0]?.Date;
    return stamp ? rocCompactToDate(stamp) : null;
  },
  now: () => new Date(),
  warn: (message) => console.warn(message),
});

/** The newest published session with how it was resolved, or null when
 *  neither FMTQIK nor the mirror answered. Memoized — see SESSION_MEMO_TTL_MS. */
export function resolvePublishedSession(): Promise<PublishedSession | null> {
  return publishedSession.resolve();
}

/** resolvePublishedSession for a provider that cannot proceed without a
 *  session: an unanswerable question fails the dataset loudly instead of
 *  returning an empty result that reads as "nothing traded". */
export async function requirePublishedSession(): Promise<PublishedSession> {
  const session = await resolvePublishedSession();
  if (!session) {
    throw new Error("Cannot resolve the latest published session: FMTQIK and the openapi STOCK_DAY_ALL mirror both failed");
  }
  return session;
}

/**
 * The newest session whose after-hours whole-market close is published, or
 * null when the sources could not be asked (never throws — the pipeline gate
 * reads null as "proceed", so a failed question never looks like "nothing new").
 */
export async function latestSessionDate(): Promise<Date | null> {
  return (await resolvePublishedSession())?.date ?? null;
}
