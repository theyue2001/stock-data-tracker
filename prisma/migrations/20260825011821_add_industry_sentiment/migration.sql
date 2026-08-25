-- AlterTable
ALTER TABLE "stocks" ADD COLUMN "subIndustry" TEXT;
ALTER TABLE "stocks" ADD COLUMN "subIndustryZh" TEXT;

-- CreateTable
CREATE TABLE "sentiment_weight_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'default',
    "advancingRatioWeight" REAL NOT NULL DEFAULT 0.25,
    "averageReturnWeight" REAL NOT NULL DEFAULT 0.20,
    "volumeExpansionWeight" REAL NOT NULL DEFAULT 0.15,
    "breakoutRatioWeight" REAL NOT NULL DEFAULT 0.15,
    "institutionalFlowWeight" REAL NOT NULL DEFAULT 0.15,
    "relativeStrengthWeight" REAL NOT NULL DEFAULT 0.10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "industry_sentiment_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "industryId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "sentimentScore" REAL NOT NULL,
    "advancingRatio" REAL NOT NULL,
    "averageReturn" REAL NOT NULL,
    "volumeExpansion" REAL NOT NULL,
    "breakoutRatio" REAL NOT NULL,
    "institutionalFlowScore" REAL NOT NULL,
    "relativeStrengthScore" REAL NOT NULL,
    "advancingSharePct" REAL NOT NULL DEFAULT 0,
    "advancingCount" INTEGER NOT NULL DEFAULT 0,
    "flatCount" INTEGER NOT NULL DEFAULT 0,
    "decliningCount" INTEGER NOT NULL DEFAULT 0,
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "averageReturnPct" REAL NOT NULL DEFAULT 0,
    "volumeRatio" REAL NOT NULL DEFAULT 1,
    "breakoutCount" INTEGER NOT NULL DEFAULT 0,
    "foreignNet" REAL NOT NULL DEFAULT 0,
    "trustNet" REAL NOT NULL DEFAULT 0,
    "dealerNet" REAL NOT NULL DEFAULT 0,
    "relativeStrengthPct" REAL NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "rank5dAgo" INTEGER,
    "rankDelta" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'neutral',
    "weightsSnapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_sentiment_snapshots_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_daily_briefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "marketSummary" TEXT NOT NULL,
    "strongestIndustries" TEXT NOT NULL,
    "weakestIndustries" TEXT NOT NULL,
    "capitalRotation" TEXT NOT NULL,
    "leadingIndicatorChanges" TEXT NOT NULL,
    "institutionalActivity" TEXT NOT NULL,
    "emergingThemes" TEXT NOT NULL,
    "stocksToWatch" TEXT NOT NULL,
    "overheatedThemes" TEXT NOT NULL,
    "keyRisks" TEXT NOT NULL,
    "tomorrowWatchlist" TEXT NOT NULL,
    "sentimentSummary" TEXT NOT NULL DEFAULT '',
    "sentimentRising" TEXT NOT NULL DEFAULT '[]',
    "sentimentFalling" TEXT NOT NULL DEFAULT '[]',
    "sentimentRankJumps" TEXT NOT NULL DEFAULT '[]',
    "sentimentStrongClusters" TEXT NOT NULL DEFAULT '[]',
    "sentimentOverheated" TEXT NOT NULL DEFAULT '[]',
    "knownFacts" TEXT NOT NULL,
    "reasonableInference" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_daily_briefs" ("capitalRotation", "createdAt", "date", "emergingThemes", "generatedBy", "id", "institutionalActivity", "keyRisks", "knownFacts", "leadingIndicatorChanges", "marketSummary", "overheatedThemes", "reasonableInference", "stocksToWatch", "strongestIndustries", "tomorrowWatchlist", "uncertainty", "weakestIndustries") SELECT "capitalRotation", "createdAt", "date", "emergingThemes", "generatedBy", "id", "institutionalActivity", "keyRisks", "knownFacts", "leadingIndicatorChanges", "marketSummary", "overheatedThemes", "reasonableInference", "stocksToWatch", "strongestIndustries", "tomorrowWatchlist", "uncertainty", "weakestIndustries" FROM "daily_briefs";
DROP TABLE "daily_briefs";
ALTER TABLE "new_daily_briefs" RENAME TO "daily_briefs";
CREATE UNIQUE INDEX "daily_briefs_date_key" ON "daily_briefs"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "sentiment_weight_configs_name_key" ON "sentiment_weight_configs"("name");

-- CreateIndex
CREATE INDEX "industry_sentiment_snapshots_industryId_date_idx" ON "industry_sentiment_snapshots"("industryId", "date");

-- CreateIndex
CREATE INDEX "industry_sentiment_snapshots_date_rank_idx" ON "industry_sentiment_snapshots"("date", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "industry_sentiment_snapshots_industryId_date_key" ON "industry_sentiment_snapshots"("industryId", "date");

-- CreateIndex
CREATE INDEX "stocks_industryId_subIndustry_idx" ON "stocks"("industryId", "subIndustry");
