/**
 * Repairs market-scope dealerNet rows written before the 單位名稱 anchoring fix.
 *
 * The defect (audit finding #1): the market-status provider selected the dealer
 * rows of TWSE's BFI82U report with an unanchored `includes("自營商")`, which
 * also matched the FOREIGN row 外資及陸資(不含外資自營商) — its parenthetical
 * disclaimer contains that substring. Every session written while that was live
 * therefore stored dealerNet = true dealer + foreign net.
 *
 * The signature is exact and was verified against the live feed: for a corrupt
 * row, `stored.dealerNet - true.dealerNet == stored.foreignNet` to the cent, and
 * after repair TWSE's own 合計 satisfies dealer + 投信 + 外資及陸資 == 合計.
 *
 * The value is re-fetched rather than corrected arithmetically. Subtracting
 * foreignNet would give the same answer for a row that IS corrupt, but there is
 * no stored flag saying which rows those are — MarketStatus has no updatedAt —
 * so a blind subtraction would silently corrupt every row that was already
 * repaired. Fetching and comparing is the only safe test.
 *
 * Both write targets are repaired: persist.ts mirrors dealerNet into the
 * scope="market" InstitutionalFlow row, so fixing only MarketStatus would leave
 * the capital-flow screen reading the stale copy.
 *
 *   npx tsx scripts/repair-dealer-net.ts              # dry run, writes nothing
 *   npx tsx scripts/repair-dealer-net.ts --apply      # repair
 *   npx tsx scripts/repair-dealer-net.ts --apply --sessions=30
 *
 * Expect roughly 4 s per session: http.ts spaces www.twse.com.tw requests to
 * survive the IP block a tighter interval triggered. Re-running is safe.
 *
 * AFTER a repair run, the scores computed from these rows are stale. Follow with
 *   npm run jobs:refresh          (recomputes the latest session)
 * or, to recompute the whole repaired range, re-run the backfill's scoring leg.
 * Then invalidate the deployed read cache — see scripts/_revalidate.ts.
 */
import { db } from "../src/lib/db";
import { TwseMarketStatusProvider } from "../src/lib/providers/live/market-status-provider";
import { utcDay } from "../src/lib/dates";
import { revalidateDeployedCache } from "./_revalidate";

/** Below this, a difference is float noise rather than the defect. The defect's
 *  magnitude is the whole foreign net — millions of NT$ thousands. */
const EPSILON = 0.5;

interface Options {
  apply: boolean;
  sessions: number;
}

function parseArgs(argv: string[]): Options {
  const n = argv.find((a) => a.startsWith("--sessions="));
  return {
    apply: argv.includes("--apply"),
    sessions: n ? Number(n.split("=")[1]) : 60,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const provider = new TwseMarketStatusProvider();

  // Only rows that actually carry institutional detail can be affected. A
  // session whose sub-report had not published yet stores zeros (audit finding
  // #5, still open) and there is nothing to compare.
  const stored = await db.marketStatus.findMany({
    where: { OR: [{ foreignNet: { not: 0 } }, { dealerNet: { not: 0 } }] },
    orderBy: { date: "desc" },
    take: opts.sessions,
    select: { id: true, date: true, foreignNet: true, trustNet: true, dealerNet: true },
  });

  console.log(
    `[repair] ${stored.length} session(s) carry institutional detail; checking each against the live feed`,
  );
  console.log(`[repair] mode: ${opts.apply ? "APPLY (will write)" : "DRY RUN (writes nothing)"}\n`);

  let corrupt = 0;
  let repaired = 0;
  let unreachable = 0;

  for (const row of stored) {
    const iso = row.date.toISOString().slice(0, 10);
    let truth;
    try {
      const fetched = await provider.fetchRange!(row.date, row.date);
      truth = fetched.find((r) => utcDay(r.date).getTime() === utcDay(row.date).getTime());
    } catch (error) {
      unreachable++;
      console.warn(`  ${iso}  SKIPPED — ${(error as Error).message}`);
      continue;
    }
    if (!truth) {
      unreachable++;
      console.warn(`  ${iso}  SKIPPED — the feed returned no session for this date`);
      continue;
    }

    // The provider now reports null when a sub-report has not published, rather
    // than the zero it used to invent. Null is not a value to compare against —
    // it means "the feed cannot tell us", so this row cannot be judged.
    if (truth.dealerNet === null || truth.foreignNet === null || truth.trustNet === null) {
      unreachable++;
      console.warn(`  ${iso}  SKIPPED — the institutional sub-report is not published for this session`);
      continue;
    }

    const drift = row.dealerNet - truth.dealerNet;
    if (Math.abs(drift) < EPSILON) continue;

    corrupt++;
    // The defect folds exactly foreignNet into dealerNet. A drift that is NOT
    // foreignNet is some other disagreement, and blindly overwriting it would
    // hide whatever that is.
    const matchesSignature = Math.abs(drift - row.foreignNet) < EPSILON;
    console.log(
      `  ${iso}  stored=${row.dealerNet.toFixed(3)}  true=${truth.dealerNet.toFixed(3)}  ` +
        `drift=${drift.toFixed(3)}  ${matchesSignature ? "(== foreignNet, the known defect)" : "*** DRIFT IS NOT foreignNet ***"}`,
    );

    if (!opts.apply) continue;
    if (!matchesSignature) {
      console.warn(`  ${iso}  NOT repaired — drift does not match the defect signature, inspect by hand`);
      continue;
    }

    await db.marketStatus.update({
      where: { id: row.id },
      data: { dealerNet: truth.dealerNet, foreignNet: truth.foreignNet, trustNet: truth.trustNet },
    });
    // persist.ts writeMarketScopeFlows mirrors these into scope="market".
    const mirrored = await db.institutionalFlow.findFirst({
      where: { scope: "market", date: utcDay(row.date) },
      select: { id: true },
    });
    if (mirrored) {
      await db.institutionalFlow.update({
        where: { id: mirrored.id },
        data: { dealerNet: truth.dealerNet, foreignNet: truth.foreignNet, trustNet: truth.trustNet },
      });
    }
    repaired++;
  }

  console.log(
    `\n[repair] checked ${stored.length}, corrupt ${corrupt}, repaired ${repaired}, unreachable ${unreachable}`,
  );
  if (!opts.apply && corrupt > 0) {
    console.log("[repair] re-run with --apply to write these corrections");
  }
  if (repaired > 0) {
    console.log("[repair] scores derived from these sessions are now stale — run `npm run jobs:refresh`");
    await revalidateDeployedCache("repair");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
