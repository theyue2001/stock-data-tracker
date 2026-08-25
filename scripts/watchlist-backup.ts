/**
 * Exports and restores the watchlist across a re-seed.
 *
 * Every seed script starts with `deleteMany()` on all tables, and
 * `WatchlistItem` is the only table holding data a person authored rather than
 * data a feed produced — so it is the only thing a re-seed can destroy that
 * cannot be re-fetched. This exists so switching between demo and live data,
 * or re-running the backfill from scratch, is not quietly lossy.
 *
 * Items are keyed by their NATURAL identifiers (industry slug, ticker,
 * indicator key), not by cuid: a re-seed issues fresh ids, so an id-based
 * backup would restore nothing.
 *
 *   npm run watchlist:backup  -- out.json
 *   npm run watchlist:restore -- out.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/lib/db";

interface PortableItem {
  itemType: string;
  industrySlug?: string;
  ticker?: string;
  indicatorKey?: string;
  note?: string | null;
}

async function exportWatchlist(path: string) {
  const items = await db.watchlistItem.findMany({
    include: {
      industry: { select: { slug: true } },
      stock: { select: { ticker: true } },
      indicator: { select: { key: true } },
    },
  });

  const portable: PortableItem[] = items.map((i) => ({
    itemType: i.itemType,
    industrySlug: i.industry?.slug,
    ticker: i.stock?.ticker,
    indicatorKey: i.indicator?.key,
    note: i.note,
  }));

  writeFileSync(path, JSON.stringify(portable, null, 2), "utf-8");
  console.log(`[watchlist] exported ${portable.length} items to ${path}`);
}

async function restoreWatchlist(path: string) {
  const portable: PortableItem[] = JSON.parse(readFileSync(path, "utf-8"));
  let restored = 0;
  const skipped: string[] = [];

  for (const item of portable) {
    const industry = item.industrySlug
      ? await db.industry.findUnique({ where: { slug: item.industrySlug }, select: { id: true } })
      : null;
    const stock = item.ticker
      ? await db.stock.findUnique({ where: { ticker: item.ticker }, select: { id: true } })
      : null;
    // Indicator keys are only unique per industry, so the key alone can match
    // more than one row; findFirst is correct because the taxonomy never
    // reuses a key across industries.
    const indicator = item.indicatorKey
      ? await db.indicator.findFirst({ where: { key: item.indicatorKey }, select: { id: true } })
      : null;

    if (!industry && !stock && !indicator) {
      skipped.push(item.industrySlug ?? item.ticker ?? item.indicatorKey ?? "?");
      continue;
    }

    await db.watchlistItem.create({
      data: {
        itemType: item.itemType,
        industryId: industry?.id ?? null,
        stockId: stock?.id ?? null,
        indicatorId: indicator?.id ?? null,
        note: item.note ?? null,
      },
    });
    restored++;
  }

  console.log(`[watchlist] restored ${restored} items`);
  if (skipped.length) {
    // A watched stock that has since been delisted, most likely.
    console.warn(`[watchlist] no longer in the taxonomy, skipped: ${skipped.join(", ")}`);
  }
}

async function main() {
  const mode = process.argv[1]?.includes("restore") ? "restore" : process.env.WATCHLIST_MODE;
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/watchlist-backup.ts <file.json> [--restore]");
    process.exit(1);
  }
  if (process.argv.includes("--restore") || mode === "restore") await restoreWatchlist(path);
  else await exportWatchlist(path);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
