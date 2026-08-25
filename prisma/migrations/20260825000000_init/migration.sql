-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industries" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "description" TEXT,
    "thesis" TEXT,
    "primaryRisk" TEXT,
    "cyclePosition" TEXT NOT NULL DEFAULT 'expansion',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "exchange" TEXT NOT NULL DEFAULT 'TWSE',
    "industryId" TEXT NOT NULL,
    "subIndustry" TEXT,
    "subIndustryZh" TEXT,
    "status" TEXT NOT NULL DEFAULT 'early_strengthening',
    "mainCatalyst" TEXT,
    "mainRisk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicators" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "unit" TEXT,
    "description" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicator_values" (
    "id" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "pctChange" DOUBLE PRECISION,
    "dataSourceId" TEXT,
    "sourceUrl" TEXT,
    "dataTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicator_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_weight_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "fundamentalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "leadingIndicatorWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "capitalFlowWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "technicalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "catalystWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_weight_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_scores" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fundamentalScore" DOUBLE PRECISION NOT NULL,
    "leadingIndicatorScore" DOUBLE PRECISION NOT NULL,
    "capitalFlowScore" DOUBLE PRECISION NOT NULL,
    "technicalScore" DOUBLE PRECISION NOT NULL,
    "catalystScore" DOUBLE PRECISION NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "weightsSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'neutral',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "relativeStrength" DOUBLE PRECISION,
    "technicalTrend" TEXT NOT NULL DEFAULT 'neutral',
    "valuationPosition" TEXT NOT NULL DEFAULT 'mid_range',
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_fundamentals" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "yoyChangePct" DOUBLE PRECISION,
    "momChangePct" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutional_flows" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "foreignNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trustNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealerNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginChange" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "turnover" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeChangePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakoutCount" INTEGER NOT NULL DEFAULT 0,
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institutional_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalysts" (
    "id" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT,
    "sourceUrl" TEXT,
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalysts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "industryId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "sourceIndicator" TEXT,
    "change" TEXT,
    "explanation" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_stocks" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,

    CONSTRAINT "alert_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_briefs" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "indicatorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_status" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "index" TEXT NOT NULL DEFAULT 'TAIEX',
    "close" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "breadthAdvancers" INTEGER NOT NULL DEFAULT 0,
    "breadthDecliners" INTEGER NOT NULL DEFAULT 0,
    "foreignNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trustNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealerNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginChange" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiment_weight_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "advancingRatioWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "averageReturnWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "volumeExpansionWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "breakoutRatioWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "institutionalFlowWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "relativeStrengthWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sentiment_weight_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_sentiment_snapshots" (
    "id" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sentimentScore" DOUBLE PRECISION NOT NULL,
    "advancingRatio" DOUBLE PRECISION NOT NULL,
    "averageReturn" DOUBLE PRECISION NOT NULL,
    "volumeExpansion" DOUBLE PRECISION NOT NULL,
    "breakoutRatio" DOUBLE PRECISION NOT NULL,
    "institutionalFlowScore" DOUBLE PRECISION NOT NULL,
    "relativeStrengthScore" DOUBLE PRECISION NOT NULL,
    "advancingSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advancingCount" INTEGER NOT NULL DEFAULT 0,
    "flatCount" INTEGER NOT NULL DEFAULT 0,
    "decliningCount" INTEGER NOT NULL DEFAULT 0,
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "averageReturnPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeRatio" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "breakoutCount" INTEGER NOT NULL DEFAULT 0,
    "foreignNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trustNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealerNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "relativeStrengthPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL,
    "previousRank" INTEGER,
    "rank5dAgo" INTEGER,
    "rankDelta" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'neutral',
    "weightsSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_sentiment_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_key_key" ON "data_sources"("key");

-- CreateIndex
CREATE UNIQUE INDEX "industries_slug_key" ON "industries"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_ticker_key" ON "stocks"("ticker");

-- CreateIndex
CREATE INDEX "stocks_industryId_idx" ON "stocks"("industryId");

-- CreateIndex
CREATE INDEX "stocks_industryId_subIndustry_idx" ON "stocks"("industryId", "subIndustry");

-- CreateIndex
CREATE UNIQUE INDEX "indicators_industryId_key_key" ON "indicators"("industryId", "key");

-- CreateIndex
CREATE INDEX "indicator_values_indicatorId_date_idx" ON "indicator_values"("indicatorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "indicator_values_indicatorId_date_key" ON "indicator_values"("indicatorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "score_weight_configs_name_key" ON "score_weight_configs"("name");

-- CreateIndex
CREATE INDEX "industry_scores_industryId_date_idx" ON "industry_scores"("industryId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "industry_scores_industryId_date_key" ON "industry_scores"("industryId", "date");

-- CreateIndex
CREATE INDEX "market_data_stockId_date_idx" ON "market_data"("stockId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "market_data_stockId_date_key" ON "market_data"("stockId", "date");

-- CreateIndex
CREATE INDEX "stock_fundamentals_stockId_idx" ON "stock_fundamentals"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_fundamentals_stockId_period_periodType_key" ON "stock_fundamentals"("stockId", "period", "periodType");

-- CreateIndex
CREATE INDEX "institutional_flows_scope_date_idx" ON "institutional_flows"("scope", "date");

-- CreateIndex
CREATE INDEX "institutional_flows_industryId_date_idx" ON "institutional_flows"("industryId", "date");

-- CreateIndex
CREATE INDEX "institutional_flows_stockId_date_idx" ON "institutional_flows"("stockId", "date");

-- CreateIndex
CREATE INDEX "catalysts_industryId_date_idx" ON "catalysts"("industryId", "date");

-- CreateIndex
CREATE INDEX "catalysts_stockId_date_idx" ON "catalysts"("stockId", "date");

-- CreateIndex
CREATE INDEX "alerts_timestamp_idx" ON "alerts"("timestamp");

-- CreateIndex
CREATE INDEX "alerts_industryId_idx" ON "alerts"("industryId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_stocks_alertId_stockId_key" ON "alert_stocks"("alertId", "stockId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_briefs_date_key" ON "daily_briefs"("date");

-- CreateIndex
CREATE INDEX "watchlist_items_itemType_idx" ON "watchlist_items"("itemType");

-- CreateIndex
CREATE UNIQUE INDEX "market_status_date_key" ON "market_status"("date");

-- CreateIndex
CREATE UNIQUE INDEX "sentiment_weight_configs_name_key" ON "sentiment_weight_configs"("name");

-- CreateIndex
CREATE INDEX "industry_sentiment_snapshots_industryId_date_idx" ON "industry_sentiment_snapshots"("industryId", "date");

-- CreateIndex
CREATE INDEX "industry_sentiment_snapshots_date_rank_idx" ON "industry_sentiment_snapshots"("date", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "industry_sentiment_snapshots_industryId_date_key" ON "industry_sentiment_snapshots"("industryId", "date");

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_scores" ADD CONSTRAINT "industry_scores_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_data" ADD CONSTRAINT "market_data_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_data" ADD CONSTRAINT "market_data_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_fundamentals" ADD CONSTRAINT "stock_fundamentals_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_flows" ADD CONSTRAINT "institutional_flows_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_flows" ADD CONSTRAINT "institutional_flows_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_flows" ADD CONSTRAINT "institutional_flows_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalysts" ADD CONSTRAINT "catalysts_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalysts" ADD CONSTRAINT "catalysts_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalysts" ADD CONSTRAINT "catalysts_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_stocks" ADD CONSTRAINT "alert_stocks_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_stocks" ADD CONSTRAINT "alert_stocks_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_sentiment_snapshots" ADD CONSTRAINT "industry_sentiment_snapshots_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

