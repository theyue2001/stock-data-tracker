import { StockTable } from "@/components/stocks/stock-table";
import { getStockRadar, getWatchlistKeys } from "@/lib/queries";

export default async function StocksPage() {
  const [rows, watchKeys] = await Promise.all([getStockRadar(), getWatchlistKeys()]);
  return <StockTable rows={rows} watchedIds={watchKeys.stockIds} />;
}
