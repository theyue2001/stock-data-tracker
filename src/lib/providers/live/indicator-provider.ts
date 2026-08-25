import { db } from "@/lib/db";
import { fetchJsonOptional } from "@/lib/providers/live/http";
import type { IndicatorProvider, IndicatorResult, ProviderSource } from "@/lib/providers/types";
import { utcDay } from "@/lib/dates";

/**
 * Leading indicators that can be sourced from free, authoritative feeds.
 *
 * Most of the indicator taxonomy in this app (SCFI, DRAM contract pricing,
 * SEMI billings, MLCC book-to-bill, panel pricing) is licensed data with no
 * free endpoint, and is left to the manual import path rather than
 * approximated — see README "Indicator coverage". What IS obtainable is
 * sourced here:
 *
 *  - Hyperscaler aggregate capex, from SEC XBRL company facts. This is the
 *    single upstream driver behind the AI-server, cooling, PCB/CCL, optical
 *    and packaging theses, and every quarter of it is arithmetic over filed
 *    numbers, not an estimate.
 *  - Taiwan ODM aggregate monthly revenue, derived from the MOPS revenue
 *    rows this app already stores — the fastest published confirmation that
 *    the capex above is converting into shipments.
 *
 * Both are dated by FIRST PUBLICATION, not by the period they describe.
 * Dating a Q1 capex figure to March 31 would let a score computed for April
 * read a number nobody could see until the end of that month, which is
 * exactly the lookahead bias that makes indicator-vs-subsequent-price
 * backtesting lie. Dating it to the last filing that mentions it is the
 * opposite error and just as damaging: a quarter reappears as a prior-year
 * comparative twelve months later, so "newest filing wins" would stamp a
 * year-stale date on a point the market traded on long before.
 */

const SEC_CONCEPT = "https://data.sec.gov/api/xbrl/companyconcept";
/** SEC asks automated clients to identify themselves; an anonymous UA is
 *  rate-limited hard and eventually blocked. */
const SEC_HEADERS = { "User-Agent": "stock-data-tracker (contact: tsungminlin@micadat.com)" };

const DAY_MS = 86_400_000;

/** A calendar quarter is 89 to 92 days; the window is loose enough that a
 *  filer whose fiscal quarter ends a few days off month-end still matches. */
const MIN_QUARTER_DAYS = 80;
const MAX_QUARTER_DAYS = 100;

/**
 * How long after a quarter ends its figure can still be treated as an
 * original publication. The 10-Q and 10-K deadlines put every genuine first
 * filing inside about 65 days, while the same quarter reappears as a
 * prior-year comparative 300-plus days late. A frame that only shows up past
 * this cutoff has no recoverable publication date at all, so it is dropped
 * rather than dated by the comparative — the whole point of the series is
 * that its dates are when the number became knowable.
 */
const MAX_PUBLICATION_LAG_DAYS = 120;

/**
 * Capex tag per hyperscaler. Filers move between tags — Amazon reported under
 * PaymentsToAcquirePropertyPlantAndEquipment through Q1 2017 and under
 * PaymentsToAcquireProductiveAssets from Q3 2018 — so each company carries a
 * candidate list and every tag in it is fetched and merged. Stopping at the
 * first tag with data would pick one side of a migration and silently discard
 * the other half of the history.
 */
const HYPERSCALERS: Array<{ label: string; cik: string; tags: string[] }> = [
  { label: "MSFT", cik: "0000789019", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"] },
  { label: "GOOGL", cik: "0001652044", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"] },
  {
    label: "AMZN",
    cik: "0001018724",
    tags: ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"],
  },
  { label: "META", cik: "0001326801", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"] },
];

interface SecConcept {
  units?: Record<string, SecFact[]>;
}

interface SecFact {
  start?: string;
  end?: string;
  val?: number;
  form?: string;
  filed?: string;
  /** Set by SEC only on the prior-year comparative copy of a fact, never on
   *  the original, so it is deliberately not used to key quarters. */
  frame?: string;
}

/** One company's capex for one calendar quarter, dated by the filing that
 *  first published it. */
interface QuarterFact {
  frame: string;
  value: number;
  filed: Date;
}

/** One rung of a filer's year-to-date ladder: spending from the fiscal year's
 *  start up to `end`, as first filed. */
interface LadderRung {
  end: string;
  value: number;
  filed: Date;
}

export class SecHyperscalerCapexProvider implements IndicatorProvider {
  readonly source: ProviderSource = {
    key: "sec-hyperscaler-capex",
    name: "SEC XBRL — Hyperscaler CapEx",
    category: "indicator",
    url: "https://data.sec.gov/",
    isMock: false,
    description:
      "Aggregate quarterly capital expenditure filed by Microsoft, Alphabet, Amazon and Meta, from SEC XBRL company facts.",
  };

  async fetchLatest(): Promise<IndicatorResult[]> {
    const perCompany = await Promise.all(HYPERSCALERS.map((h) => this.fetchCompanyQuarters(h)));
    const reporting = perCompany.filter((m) => m.size > 0);
    // If a feed is unreachable, emitting a sum over the survivors would show
    // up as a capex collapse rather than as missing data.
    if (reporting.length < HYPERSCALERS.length) {
      console.warn(
        `[indicators] hyperscaler capex skipped: ${reporting.length}/${HYPERSCALERS.length} filers returned data`,
      );
      return [];
    }

    // Only quarters every filer has reported, so the aggregate never dips
    // purely because one company files later than the others. This leaves a
    // real hole from Q2 2017 to Q2 2018, when Amazon tagged the line item
    // under neither of its candidate tags; a hole is the honest answer, since
    // the alternative is a three-filer sum that reads as a capex crash.
    const frames = [...reporting[0].keys()].filter((f) => reporting.every((m) => m.has(f)));
    frames.sort();

    const results = frames.map((frame) => {
      const facts = reporting.map((m) => m.get(frame)!);
      const totalUsd = facts.reduce((sum, f) => sum + f.value, 0);
      // Dated to the last filer, i.e. the day the aggregate became knowable.
      const date = facts.reduce((latest, f) => (f.filed > latest ? f.filed : latest), facts[0].filed);
      return {
        indicatorKey: "hyperscaler_capex",
        date: utcDay(date),
        value: Math.round((totalUsd / 1e9) * 100) / 100, // USD bn/qtr
        sourceUrl: "https://www.sec.gov/edgar/searchedgar/companysearch",
      };
    });

    // Consecutive quarters are published about three months apart, so two of
    // them sharing a date should be impossible. It is worth checking anyway:
    // IndicatorValue is unique on (indicator, date) and writeIndicatorValues
    // upserts, so a collision would destroy a quarter without failing. Warn
    // and drop rather than throw, since throwing here aborts the whole
    // nightly refresh over one bad point.
    const seen = new Set<number>();
    return results.filter((r) => {
      if (seen.has(r.date.getTime())) {
        console.warn(
          `[indicators] dropping hyperscaler capex point with duplicate date ${r.date.toISOString().slice(0, 10)}`,
        );
        return false;
      }
      seen.add(r.date.getTime());
      return true;
    });
  }

  /** Every calendar quarter this filer has published, merged across all of
   *  its candidate tags. */
  private async fetchCompanyQuarters(company: (typeof HYPERSCALERS)[number]): Promise<Map<string, QuarterFact>> {
    const quarters = new Map<string, QuarterFact>();
    for (const tag of company.tags) {
      const url = `${SEC_CONCEPT}/CIK${company.cik}/us-gaap/${tag}.json`;
      const payload = await fetchJsonOptional<SecConcept>(url, { headers: SEC_HEADERS });
      const facts = payload?.units?.USD;
      if (!facts?.length) continue;
      collectQuarters(facts, quarters);
    }
    return quarters;
  }
}

/**
 * Reduce one tag's raw facts to single-quarter figures, merged into
 * `quarters`.
 *
 * A cash-flow tag is reported year-to-date: a 10-Q carries the fiscal year so
 * far, not the quarter on its own. Some filers additionally tag the discrete
 * quarter, but not reliably — Meta only ever does so for Q1 and Microsoft's
 * fiscal Q4 exists only inside the annual figure — so taking the ~90-day
 * spans and nothing else left an intersection of Q1s, a once-a-year series
 * stored and labelled as quarterly.
 *
 * So the quarters are differenced out of the ladder instead. Every fact filed
 * against one fiscal year shares that year's `start`, so grouping on `start`
 * recovers each filer's own ladder — Microsoft's runs off July 1, the other
 * three off January 1, and assuming a calendar year would mis-slice
 * Microsoft's — and consecutive rungs differ by exactly one quarter of
 * spending. Differencing has the side benefit that a filer's four quarters
 * always sum to the fiscal-year total it filed; where SEC does also publish
 * the discrete quarter, the two agree to within its own $1m rounding.
 *
 * Each quarter is dated by the FIRST filing that carried it. The same figure
 * reappears a year later as a prior-year comparative — and it is only the
 * comparative that SEC stamps with a `frame` attribute, which is why the
 * frame is always computed from the period end here rather than read off the
 * fact.
 */
function collectQuarters(facts: SecFact[], quarters: Map<string, QuarterFact>): void {
  const ladders = new Map<string, Map<string, LadderRung>>();
  for (const fact of facts) {
    if (!fact.start || !fact.end || !fact.filed || typeof fact.val !== "number") continue;
    const filed = new Date(`${fact.filed}T00:00:00.000Z`);
    const rungs = ladders.get(fact.start) ?? new Map<string, LadderRung>();
    const existing = rungs.get(fact.end);
    // One rung per period end, taken from its earliest filing, so the ladder
    // is built entirely out of originals and a restated comparative can never
    // be differenced against an original.
    if (!existing || filed < existing.filed) rungs.set(fact.end, { end: fact.end, value: fact.val, filed });
    ladders.set(fact.start, rungs);
  }

  for (const [start, rungs] of ladders) {
    let prev: LadderRung | null = null;
    for (const rung of [...rungs.values()].sort((a, b) => a.end.localeCompare(b.end))) {
      // A step wider than one quarter means a rung is missing from the
      // payload, and differencing across the hole would file two quarters of
      // spending under one date.
      const stepDays = (Date.parse(rung.end) - Date.parse(prev ? prev.end : start)) / DAY_MS;
      if (stepDays >= MIN_QUARTER_DAYS && stepDays <= MAX_QUARTER_DAYS) {
        // Both rungs have to be out before the difference between them is
        // knowable; in a normal ladder that is the later one.
        const filed = prev && prev.filed > rung.filed ? prev.filed : rung.filed;
        if ((filed.getTime() - Date.parse(rung.end)) / DAY_MS <= MAX_PUBLICATION_LAG_DAYS) {
          const frame = calendarFrame(rung.end);
          const existing = quarters.get(frame);
          // A quarter derivable more than one way — a discrete fact as well
          // as a ladder step, or two tags spanning a migration — belongs to
          // whichever filing published it first.
          if (!existing || filed < existing.filed) {
            quarters.set(frame, { frame, value: prev ? rung.value - prev.value : rung.value, filed });
          }
        }
      }
      prev = rung;
    }
  }
}

/**
 * Taiwan server-ODM aggregate monthly revenue.
 *
 * Derived rather than fetched: the underlying rows are the same MOPS filings
 * the fundamental provider already stores, so this adds no request and can
 * never disagree with the per-stock revenue the stock pages display. The
 * constituents are whichever stocks belong to the industry that owns the
 * indicator, so adding an ODM to the taxonomy updates the series too.
 */
export class DerivedOdmRevenueProvider implements IndicatorProvider {
  readonly source: ProviderSource = {
    key: "derived-odm-revenue",
    name: "Derived — Taiwan Server ODM Aggregate Revenue",
    category: "indicator",
    url: "https://mops.twse.com.tw/",
    isMock: false,
    description:
      "Sum of the MOPS-filed monthly operating revenue of the AI-server ODM constituents, expressed in NT$ bn.",
  };

  async fetchLatest(): Promise<IndicatorResult[]> {
    const indicator = await db.indicator.findFirst({
      where: { key: "odm_monthly_revenue" },
      include: { industry: { include: { stocks: { select: { id: true } } } } },
    });
    if (!indicator) return [];

    const stockIds = indicator.industry.stocks.map((s) => s.id);
    if (!stockIds.length) return [];

    const rows = await db.stockFundamental.findMany({
      where: { stockId: { in: stockIds }, periodType: "monthly_revenue", isMock: false },
      select: { stockId: true, period: true, value: true },
    });

    const byPeriod = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const bucket = byPeriod.get(row.period) ?? new Map<string, number>();
      bucket.set(row.stockId, row.value);
      byPeriod.set(row.period, bucket);
    }

    const results: IndicatorResult[] = [];
    for (const [period, bucket] of [...byPeriod].sort(([a], [b]) => a.localeCompare(b))) {
      // Same reasoning as the capex aggregate: a partial month would read as
      // a revenue collapse instead of as an incomplete filing set.
      if (bucket.size < stockIds.length) continue;
      const totalThousands = [...bucket.values()].reduce((a, b) => a + b, 0);
      results.push({
        indicatorKey: "odm_monthly_revenue",
        date: publicationDate(period),
        value: Math.round((totalThousands / 1e6) * 100) / 100, // 仟元 -> NT$ bn
        sourceUrl: "https://mops.twse.com.tw/mops/web/t21sc03_ifrs",
      });
    }
    return results;
  }
}

/** "CY2026Q1" from a period end date. Always computed rather than read from
 *  the fact's own `frame`, which SEC only sets on the comparative copy. */
function calendarFrame(end: string): string {
  const date = new Date(`${end}T00:00:00.000Z`);
  return `CY${date.getUTCFullYear()}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** Taiwan-listed companies must file the prior month's revenue by the 10th,
 *  so that is the date the aggregate first became public. */
function publicationDate(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return utcDay(new Date(Date.UTC(year, month, 10)));
}
