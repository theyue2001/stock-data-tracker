-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_watchlist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemType" TEXT NOT NULL,
    "industryId" TEXT,
    "stockId" TEXT,
    "indicatorId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watchlist_items_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "watchlist_items_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "stocks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "watchlist_items_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "indicators" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_watchlist_items" ("createdAt", "id", "indicatorId", "industryId", "itemType", "note", "stockId") SELECT "createdAt", "id", "indicatorId", "industryId", "itemType", "note", "stockId" FROM "watchlist_items";
DROP TABLE "watchlist_items";
ALTER TABLE "new_watchlist_items" RENAME TO "watchlist_items";
CREATE INDEX "watchlist_items_itemType_idx" ON "watchlist_items"("itemType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
