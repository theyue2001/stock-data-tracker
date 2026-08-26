-- CreateTable
CREATE TABLE "intraday_index" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "index" TEXT NOT NULL DEFAULT 'TAIEX',
    "last" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "tickAt" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intraday_index_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intraday_index_index_date_key" ON "intraday_index"("index", "date");

-- AddForeignKey
ALTER TABLE "intraday_index" ADD CONSTRAINT "intraday_index_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
