-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "industries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "description" TEXT,
    "thesis" TEXT,
    "cyclePosition" TEXT NOT NULL DEFAULT 'expansion',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "exchange" TEXT NOT NULL DEFAULT 'TWSE',
    "industryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'early_strengthening',
    "mainCatalyst" TEXT,
    "mainRisk" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "stocks_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "indicators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "industryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameZh" TEXT,
    "unit" TEXT,
    "description" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "indicators_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "indicator_values" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "indicatorId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "previousValue" REAL,
    "pctChange" REAL,
    "dataSourceId" TEXT,
    "sourceUrl" TEXT,
    "dataTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "indicator_values_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "indicator_values_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "score_weight_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'default',
    "fundamentalWeight" REAL NOT NULL DEFAULT 0.30,
    "leadingIndicatorWeight" REAL NOT NULL DEFAULT 0.25,
    "capitalFlowWeight" REAL NOT NULL DEFAULT 0.20,
    "technicalWeight" REAL NOT NULL DEFAULT 0.15,
    "catalystWeight" REAL NOT NULL DEFAULT 0.10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "industry_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "industryId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "fundamentalScore" REAL NOT NULL,
    "leadingIndicatorScore" REAL NOT NULL,
    "capitalFlowScore" REAL NOT NULL,
    "technicalScore" REAL NOT NULL,
    "catalystScore" REAL NOT NULL,
    "totalScore" REAL NOT NULL,
    "weightsSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'neutral',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "industry_scores_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "change" REAL NOT NULL,
    "changePct" REAL NOT NULL,
    "relativeStrength" REAL,
    "technicalTrend" TEXT NOT NULL DEFAULT 'neutral',
    "valuationPosition" TEXT NOT NULL DEFAULT 'mid_range',
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "market_data_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "market_data_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stock_fundamentals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "yoyChangePct" REAL,
    "momChangePct" REAL,
    "eps" REAL,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_fundamentals_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "institutional_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "scope" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "foreignNet" REAL NOT NULL DEFAULT 0,
    "trustNet" REAL NOT NULL DEFAULT 0,
    "dealerNet" REAL NOT NULL DEFAULT 0,
    "marginChange" REAL NOT NULL DEFAULT 0,
    "turnover" REAL NOT NULL DEFAULT 0,
    "volumeChangePct" REAL NOT NULL DEFAULT 0,
    "breakoutCount" INTEGER NOT NULL DEFAULT 0,
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "institutional_flows_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "institutional_flows_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "institutional_flows_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "catalysts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "industryId" TEXT,
    "stockId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATETIME NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "source" TEXT,
    "sourceUrl" TEXT,
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalysts_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "catalysts_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "catalysts_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "industryId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "sourceIndicator" TEXT,
    "change" TEXT,
    "explanation" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alerts_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_stocks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    CONSTRAINT "alert_stocks_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "alert_stocks_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "daily_briefs" (
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
    "knownFacts" TEXT NOT NULL,
    "reasonableInference" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemType" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "indicatorId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watchlist_items_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "watchlist_items_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "market_status" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "index" TEXT NOT NULL DEFAULT 'TAIEX',
    "close" REAL NOT NULL,
    "change" REAL NOT NULL,
    "changePct" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "breadthAdvancers" INTEGER NOT NULL DEFAULT 0,
    "breadthDecliners" INTEGER NOT NULL DEFAULT 0,
    "foreignNet" REAL NOT NULL DEFAULT 0,
    "trustNet" REAL NOT NULL DEFAULT 0,
    "dealerNet" REAL NOT NULL DEFAULT 0,
    "marginChange" REAL NOT NULL DEFAULT 0,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE UNIQUE INDEX "watchlist_items_itemType_industryId_stockId_indicatorId_key" ON "watchlist_items"("itemType", "industryId", "stockId", "indicatorId");

-- CreateIndex
CREATE UNIQUE INDEX "market_status_date_key" ON "market_status"("date");
