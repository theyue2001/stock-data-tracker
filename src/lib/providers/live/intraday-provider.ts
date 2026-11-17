import { fetchJson } from "@/lib/providers/live/http";
import { parseNumber } from "@/lib/providers/live/parse";
import { isTradingDay, sessionKey, taipeiNow } from "@/lib/market-session";
import { formatTaipei } from "@/lib/intraday-cadence";
import type { IntradayIndexProvider, IntradayIndexResult, ProviderSource } from "@/lib/providers/types";

/**
 * TAIEX level from TWSE's real-time market-information (MIS) feed — the same
 * endpoint the official quote page polls. Every other live provider in this
 * codebase reads an AFTER-HOURS report, which only carries a session's final
 * numbers once TWSE has settled it; this is the only source with anything to
 * say between 09:00 and 13:30.
 *
 * Scope is deliberately just the index, not the 55 tracked stocks: a per-stock
 * poll would mean 55 rows to reconcile against, none of which can safely flow
 * into MarketData (see IntradayIndex's schema comment for why), for a value
 * this project has no intraday-scoped screen to show yet — and MIS is not
 * licensed for per-stock redistribution anyway (see `intradayQuoteProviders`
 * in registry.ts). The index alone is enough to make the KPI strip's headline
 * number move during the session.
 */

const MIS_QUOTE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const REFERER = "https://mis.twse.com.tw/stock/index.jsp";

/** Observed shape (2026-11-17 16:06 Taipei): rtcode "0000", userDelay 5000,
 *  msgArray[0] = { d: "20261117", t: "13:33:00", tlong: "1794893580000", z, y, h, l, … }. */
interface MisMsg {
  d?: string; // "20261117" — Gregorian, unlike every after-hours report
  t?: string; // "13:33:00" — Taipei time of the last tick behind z/h/l
  tlong?: string; // "1794893580000" — the same tick as epoch ms
  z?: string; // last; "-" before the first trade of the session
  y?: string; // prior close
  h?: string;
  l?: string;
}

export interface MisResponse {
  msgArray?: MisMsg[];
  rtcode?: string;
  rtmessage?: string;
  /** The page's own refresh hint for a browser, in ms (5000 when observed). */
  userDelay?: number;
}

const HHMMSS = /^\d{2}:\d{2}:\d{2}$/;

function compactToIso(d: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d?.trim() ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The tick's instant: `tlong` when present, else `d` + `t` read as Taipei time. */
function tickInstant(msg: MisMsg, session: string): number | null {
  const tlong = Number(msg.tlong);
  if (msg.tlong && Number.isFinite(tlong) && tlong > 0) return tlong;
  if (msg.t && HHMMSS.test(msg.t)) return Date.parse(`${session}T${msg.t}+08:00`);
  return null;
}

/**
 * Validates one getStockInfo payload for `tse_t00.tw` and turns it into at
 * most one TAIEX tick.
 *
 * Throws when the feed answered with something that cannot be a valid tick —
 * a non-"0000" rtcode, a session date the TWSE calendar says did not trade, or
 * a tick instant that falls on a different Taipei day than the session it
 * claims — so the job log records a failure instead of a holiday or
 * mis-dated row. Returns [] when the feed is fine but has no trade yet
 * (`z` is "-" before the first match of the session): never a price
 * borrowed from the prior close, the open, or the order book.
 *
 * Exported for tests.
 */
export function parseMisIndexPayload(payload: MisResponse): IntradayIndexResult[] {
  if (payload.rtcode !== "0000") {
    const message = payload.rtmessage ? ` (${payload.rtmessage})` : "";
    throw new Error(`MIS answered rtcode ${payload.rtcode ?? "(missing)"}${message}, expected 0000`);
  }
  const msg = payload.msgArray?.[0];
  if (!msg) throw new Error("MIS returned no row for tse_t00.tw (TAIEX)");

  const session = compactToIso(msg.d);
  if (!session) throw new Error(`MIS row has no usable session date (d=${JSON.stringify(msg.d)})`);
  if (!isTradingDay(session)) {
    throw new Error(`MIS reports session ${session}, which is not a trading day in the TWSE calendar`);
  }

  const last = parseNumber(msg.z);
  const priorClose = parseNumber(msg.y);
  const high = parseNumber(msg.h);
  const low = parseNumber(msg.l);
  // No trade yet this session: nothing to write, not a zero- or prior-close-filled row.
  if (last === null || priorClose === null || high === null || low === null) return [];

  const tickEpochMs = tickInstant(msg, session);
  if (tickEpochMs === null) {
    throw new Error(`MIS row has no usable tick time (tlong=${JSON.stringify(msg.tlong)}, t=${JSON.stringify(msg.t)})`);
  }
  const tickDay = taipeiNow(new Date(tickEpochMs)).date;
  if (tickDay !== session) {
    throw new Error(
      `MIS tick ${new Date(tickEpochMs).toISOString()} falls on ${tickDay} (Taipei), not on its session ${session}`,
    );
  }

  const change = last - priorClose;
  return [
    {
      date: sessionKey(session),
      index: "TAIEX",
      last,
      change,
      changePct: priorClose > 0 ? (change / priorClose) * 100 : 0,
      high,
      low,
      tickAt: msg.t && HHMMSS.test(msg.t) ? msg.t : formatTaipei(new Date(tickEpochMs)).slice(11),
      tickEpochMs,
    },
  ];
}

export class TwseMisIndexProvider implements IntradayIndexProvider {
  readonly source: ProviderSource = {
    key: "twse-mis-intraday",
    name: "TWSE MIS Real-Time Quote (TAIEX)",
    category: "market_data",
    url: "https://mis.twse.com.tw/stock/index.jsp",
    isMock: false,
    description: "Real-time TAIEX level from the TWSE market-information feed, polled at most once a minute while the market is open.",
  };

  /**
   * 60 s, and deliberately not lower. mis.twse.com.tw (基本市況報導) is TWSE's
   * free public VIEWING page, not a licensed data feed: TWSE reserves the IP
   * in its trading information and requires a written contract before it is
   * redistributed in value-added form (TWSE FAQ). It publishes no allowance
   * for automated clients, and its payload asks one browser to refresh no
   * faster than `userDelay` (5 s). One backend process reading one row once a
   * minute — shared by every viewer, never a per-browser call — is the
   * smallest footprint that still moves the KPI strip, which shows the index
   * at minute granularity anyway. A faster cadence needs a licensed feed
   * (see `intradayQuoteProviders` in registry.ts), not a smaller number here.
   */
  readonly minIntervalSeconds = 60;

  async fetchLatest(): Promise<IntradayIndexResult[]> {
    const payload = await fetchJson<MisResponse>(`${MIS_QUOTE}?ex_ch=tse_t00.tw&json=1&delay=0`, {
      headers: { Referer: REFERER },
      // The whole point of this provider is the value that moved since the
      // last poll a minute ago; the shared 10-minute response cache would
      // defeat it inside the long-running scheduler.
      noCache: true,
      // A tick is only worth something within its own interval: one quick
      // retry, a 10 s timeout, and no three-minute block cooldown — the next
      // scheduled tick is the real retry.
      retries: 1,
      timeoutMs: 10_000,
      blockCooldown: false,
    });
    return parseMisIndexPayload(payload);
  }
}
