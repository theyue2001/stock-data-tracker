import { fetchJsonOptional } from "@/lib/providers/live/http";
import { parseNumber, westernCompactToDate } from "@/lib/providers/live/parse";
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
 * this project has no intraday-scoped screen to show yet. The index alone is
 * enough to make the KPI strip's headline number move during the session.
 */

const MIS_QUOTE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const REFERER = "https://mis.twse.com.tw/stock/index.jsp";

interface MisMsg {
  d?: string; // "20260826" — Gregorian, unlike every after-hours report
  t?: string; // "13:33:00" — time of the last tick behind z/h/l
  z?: string; // last
  y?: string; // prior close
  h?: string;
  l?: string;
}

interface MisResponse {
  msgArray?: MisMsg[];
  rtcode?: string;
}

export class TwseMisIndexProvider implements IntradayIndexProvider {
  readonly source: ProviderSource = {
    key: "twse-mis-intraday",
    name: "TWSE MIS Real-Time Quote (TAIEX)",
    category: "market_data",
    url: "https://mis.twse.com.tw/stock/index.jsp",
    isMock: false,
    description: "Real-time TAIEX level from the TWSE market-information feed, polled while the market is open.",
  };

  async fetchLatest(): Promise<IntradayIndexResult[]> {
    const payload = await fetchJsonOptional<MisResponse>(`${MIS_QUOTE}?ex_ch=tse_t00.tw&json=1&delay=0`, {
      headers: { Referer: REFERER },
      // The whole point of this provider is the value that moved since the
      // last poll a minute ago; the shared 10-minute response cache would
      // defeat it inside the long-running scheduler.
      noCache: true,
    });
    const msg = payload?.msgArray?.[0];
    if (!msg) return [];

    const date = msg.d ? westernCompactToDate(msg.d) : null;
    const last = parseNumber(msg.z);
    const priorClose = parseNumber(msg.y);
    const high = parseNumber(msg.h);
    const low = parseNumber(msg.l);
    // No tick yet this session (pre-open) reports "z":"-": nothing to write,
    // not a zero-filled row.
    if (!date || last === null || priorClose === null || high === null || low === null) return [];

    const change = last - priorClose;
    return [
      {
        date,
        index: "TAIEX",
        last,
        change,
        changePct: priorClose > 0 ? (change / priorClose) * 100 : 0,
        high,
        low,
        tickAt: msg.t ?? "",
      },
    ];
  }
}
