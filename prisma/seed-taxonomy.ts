/**
 * Seeds ONLY the reference data: industries, their constituent stocks, the
 * indicator definitions, and the two weight configs.
 *
 * This is the live-data counterpart to seed.ts. It writes no prices, no
 * flows, no indicator values, no scores — nothing numeric at all — because in
 * live mode every number comes from `npm run db:backfill` and the nightly job.
 * Seeding synthetic values first and overwriting them later would leave any
 * date the feeds do not cover holding invented data that looks real.
 *
 * The taxonomy itself (industry groupings, tickers, sub-industry
 * classifications, indicator definitions, theses and risks) is authored
 * research, not generated, and is shared with the demo seed.
 *
 * Run with: npm run db:seed:live
 */
import { db } from "../src/lib/db";
import { SEED_INDUSTRIES } from "./seed-data";
import { DEFAULT_SCORE_WEIGHTS } from "../src/lib/scoring";
import { DEFAULT_SENTIMENT_WEIGHTS } from "../src/lib/sentiment";
import { resolveExchanges } from "../src/lib/providers/live/market-data-provider";

async function main() {
  console.log("Clearing existing data...");
  // Delete in FK-safe order.
  await db.alertStock.deleteMany();
  await db.alert.deleteMany();
  await db.watchlistItem.deleteMany();
  await db.dailyBrief.deleteMany();
  await db.industrySentimentSnapshot.deleteMany();
  await db.catalyst.deleteMany();
  await db.institutionalFlow.deleteMany();
  await db.stockFundamental.deleteMany();
  await db.marketData.deleteMany();
  await db.industryScore.deleteMany();
  await db.indicatorValue.deleteMany();
  await db.indicator.deleteMany();
  await db.stock.deleteMany();
  await db.industry.deleteMany();
  await db.marketStatus.deleteMany();
  await db.scoreWeightConfig.deleteMany();
  await db.sentimentWeightConfig.deleteMany();
  await db.dataSource.deleteMany();

  console.log("Seeding weight configs...");
  await db.scoreWeightConfig.create({ data: { name: "default", ...DEFAULT_SCORE_WEIGHTS, isActive: true } });
  await db.sentimentWeightConfig.create({
    data: { name: "default", ...DEFAULT_SENTIMENT_WEIGHTS, isActive: true },
  });

  // Resolve the real board for every ticker up front. A stock seeded with the
  // wrong exchange gets queried against the wrong host for its whole history
  // and comes back empty, which is indistinguishable from a quiet stock.
  const allTickers = SEED_INDUSTRIES.flatMap((i) => i.stocks.map((s) => s.ticker));
  console.log(`Resolving exchange for ${allTickers.length} tickers...`);
  const exchanges = await resolveExchanges(allTickers);
  const notListed = allTickers.filter((t) => !exchanges.get(t));

  for (const [sortOrder, seedInd] of SEED_INDUSTRIES.entries()) {
    const industry = await db.industry.create({
      data: {
        slug: seedInd.slug,
        name: seedInd.name,
        nameZh: seedInd.nameZh,
        description: seedInd.description,
        thesis: seedInd.thesis,
        cyclePosition: seedInd.cyclePosition,
        riskLevel: seedInd.riskLevel,
        primaryRisk: seedInd.risks[0] ?? null,
        sortOrder,
      },
    });

    for (const [idx, seedIndicator] of seedInd.indicators.entries()) {
      await db.indicator.create({
        data: {
          industryId: industry.id,
          key: seedIndicator.key,
          name: seedIndicator.name,
          unit: seedIndicator.unit,
          description: seedIndicator.description,
          frequency: seedIndicator.frequency,
          higherIsBetter: seedIndicator.higherIsBetter,
          sortOrder: idx,
        },
      });
    }

    for (const seedStock of seedInd.stocks) {
      await db.stock.create({
        data: {
          ticker: seedStock.ticker,
          name: seedStock.name,
          nameZh: seedStock.nameZh,
          // Resolved from the live listings, falling back to whatever the
          // taxonomy claims when a ticker is not trading at all.
          exchange: exchanges.get(seedStock.ticker) ?? seedStock.exchange ?? "TWSE",
          industryId: industry.id,
          subIndustry: seedStock.subIndustry,
          subIndustryZh: seedStock.subIndustryZh,
          mainCatalyst: seedStock.mainCatalyst,
          mainRisk: seedStock.mainRisk,
          // Left at the schema default; the refresh job derives the real one
          // from price action and revenue momentum.
        },
      });
    }

    console.log(
      `  ${seedInd.name}: ${seedInd.stocks.length} stocks, ${seedInd.indicators.length} indicators`,
    );
  }

  console.log("\nTaxonomy seeded:", {
    industries: await db.industry.count(),
    stocks: await db.stock.count(),
    indicators: await db.indicator.count(),
  });

  if (notListed.length) {
    console.warn(
      `\nWARNING: not listed on TWSE or TPEx (merged or delisted) — these will never receive data: ${notListed.join(", ")}`,
    );
  }

  console.log("\nNo numeric data was written. Next: npm run db:backfill");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
