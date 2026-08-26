# 法人買賣超無資料時顯示「無」

分支：`fix/flow-nodata-badge`

## 目標

1. 法人買賣超無資料時，`capitalFlowScore` / `institutionalFlowScore` 不再以 50 當成真實中性資料，改為排除於加權之外並在 UI 顯示「無資料」。
2. 實際參與權重低於 60% 時，整列顯示「參考性低」。
3. 熱度分數與氣氛值共用同一個價格 session 判定法人資料是否為當期。

不做：依使用者決定，不執行 `npm run db:backfill -- --only=recompute`，不改寫正式 Neon 既有歷史列。

## 已完成

- 新增 `src/lib/weights-snapshot.ts`，統一解析 snapshot、判定分項是否參與、計算參與比率與低參考性。
- 新增共用 `flowIsCurrent` / `latestSessionDate`；兩套計分都以所有成員股的最新交易日為 session。
- 無當期法人資料（或沒有可用成交值）時，把相應權重歸零後重新正規化總分；資料庫的 NOT NULL 分項欄仍存惰性的 50，snapshot 記錄該分項未參與。
- 讀取層把未參與的資金流轉成 `null`；完全沒有 score row 時也不再誤顯示為 0／「強力流出」。
- 產業卡、產業詳情、追蹤清單、產業氣氛與 AI brief 都能區分真實 0、無資料及低參考性。
- 對抗式差異審查補上三個邊界：無 score row、成員股 session 不同步、法人資料存在但成交值為 0。
- 更新 backfill 操作訊息，說明缺資料會排除加權，而不是寫入假中性分數。

## 下一步

- 無必要程式工作。
- 下一次正常排程寫入新 snapshot 後，畫面才會出現本次新增的資金流「無資料」／「參考性低」狀態；既有 1288 列維持原 snapshot 與原顯示。

## 驗證狀態

- `npm run typecheck`：通過，exit 0。
- `npm run lint`：通過，exit 0。
- `git diff --check`：通過。
- `npm run build`：應用程式 build 尚未開始即被既有 dev server 鎖住 Prisma Windows query engine（EPERM）；本次未改 schema／generated client，也未中止使用者程序。
- `npx next build`：通過，43/43 static pages 完成，14 個產業動態路由成功產生；只有 Prisma 產生碼既有的 Turbopack tracing 警告。
- 接手前唯讀驗證：25 項純函式／真實資料檢查全數 PASS；2026-08-25 的 14 個產業中，`flowSource === "none"` 與 `institutionalFlowWeight === 0` 無不一致。
- 接手後邊界驗證：18 項 assertion 全數 PASS，涵蓋 null 與 0、不一致 session、snapshot 新舊行為、0.60 參考性門檻、重新正規化及無 score row。
- 瀏覽器（production server，port 3002）：走訪 `/`、`/momentum`、`/industries`、`/industries/ai-server`、`/capital-flow`、`/stocks`、`/indicators`、`/daily-brief`、`/watchlist`，9 條路由皆顯示預期頁面、無 404、零 console error。
- 視覺檢查 `/industries/ai-server`：詳情頁資金流為「強力流出」，與產業卡詞彙一致；版面無明顯異常。
- 限制：近期 DB session 的法人資料完整，且歷史 snapshot 尚未重算，因此無法以瀏覽器直接重現資金流「無資料」／「參考性低」；這兩條路徑以純函式與讀取層邊界測試驗證，未寫入正式 DB。
