# intraday-quotes

## 目標

盤中（08:30–13:30 台北時間，週一至週五）每分鐘更新即時報價，其他時間每 5 分鐘檢查一次是否有新的盤後資料。新增獨立的盤中即時報價資料源與表，不影響現有日 K／法人流／產業分數／氣氛分數的計算。

## 已完成

1. `prisma/schema.prisma` 新增 `IntradayIndex` 表（TAIEX 盤中 tick，與 MarketStatus 完全分離，不參與任何評分），並套用 migration `20260826090025_add_intraday_index` 到 .env 指向的正式 Neon（純 CREATE TABLE，經使用者確認後執行）。
2. `src/lib/providers/live/intraday-provider.ts`：`TwseMisIndexProvider`，讀 TWSE MIS 即時報價端點（`mis.twse.com.tw/stock/api/getStockInfo.jsp`），只取 TAIEX 指數。
3. `src/lib/jobs/refresh-intraday.ts` + `scripts/run-intraday.ts` + `npm run jobs:intraday`。
4. `src/app/api/jobs/intraday/route.ts`（GET/POST，走既有 `authorizeJob`）。
5. 快取：`CACHE_TAGS.intraday` 獨立於 `radarData`，`getIntradayIndex()`（`src/lib/queries.ts`）用 `cacheLife("minutes")`；`/api/jobs/revalidate` 加 `?tag=intraday` 分流。
6. UI（`src/app/page.tsx`）：TAIEX KPI 格與頁首 note 在有盤中 tick 時改顯示即時值＋「盤中 HH:MM」標籤，其餘畫面不變。
7. `scripts/cron.ts`：改兩條節奏 — 盤中每分鐘 tick（3 個 cron 表達式涵蓋 08:30–13:30）、其他時間每 5 分鐘檢查（`hasTodaysSession` guard，當日已有資料即為 no-op，避免整天重打 TWSE）。`vercel.json` 同步新增對應 cron 項目；`/api/jobs/daily` 內建同一 guard，讓 serverless 5 分鐘輪詢安全。
8. `src/lib/jobs/verify-sources.ts` 加 `intraday-index` 健康檢查。
9. README／`.env.example` 同步更新排程說明，並明確記載 **Vercel Hobby 方案做不到分鐘級 cron**（Hobby 一天只保證觸發一次、且時間不準）。

### 第二階段：改走外部排程服務（使用者選定方案 A）

10. **修掉一個會讓「每分鐘更新」實際變成「每 10 分鐘更新」的 bug**：`src/lib/providers/live/http.ts` 的 `fetchJson` 有 10 分鐘 `responseCache`（`CACHE_TTL_MS`），在常駐 `npm run cron` 程序裡會讓每分鐘的輪詢有 9/10 次拿到快取舊值。新增 `FetchOptions.noCache` 並在 intraday provider 帶上；serverless 每次都是新 process 所以原本不受影響，但常駐路徑會壞。
11. `http.ts` 的 `HOST_MIN_INTERVAL_MS` 明確加上 `mis.twse.com.tw: 1000`（原本落在 fallback 同值，但寫明以免日後改 fallback 誤動到即時輪詢）。
12. **修掉 `getIntradayIndex()` 的時區不一致**：原本用 `utcDay()` 查詢，但資料列的 date 來自 MIS 的台北交易日；兩者只在 UTC 00:00–16:00 相同。盤中時段剛好相同所以看起來正常，晚間才會分歧。改用 `taipeiToday()`。
13. `vercel.json` 縮成 **2 條每日安全網**（Hobby 上限就是 2 條、一天一次），真正的頻率交給外部排程服務。
14. README 新增「Driving the jobs from outside」章節：三種驅動方式的比較表、兩個端點的台北／UTC 排程式、`Authorization: Bearer <CRON_SECRET>` header、為什麼兩個端點都可以安全地被過度呼叫（intraday 是 `(index, date)` upsert；假日回上一交易日的 tick 會落在那一天自己的列上，因此不會被誤render成今天的盤中徽章）、以及 GitHub Actions 排程不保證準時、不適合每分鐘那段的注意事項。部署章節補上第 6 步。

## 下一步

- **需要使用者操作**：到外部排程服務（cron-job.org 等）建立兩條排程並帶上 `Authorization` header，以及在 Vercel 設 `CRON_SECRET`／`APP_URL` 環境變數。程式碼側已完備，我無法代為註冊外部服務帳號。
- 分支 `feat/intraday-quotes` 尚未合併到 `master`，尚未部署。
- 後續若要精確跳過台股假日可再加 holiday calendar；目前假日會持續每 5 分鐘輪詢直到收盤資料出現，屬已知、可接受的成本。

## 驗證狀態

- Lint／Typecheck／Build：`npm run lint`、`npm run typecheck`、`npm run build` 均通過（build 含針對正式 Neon 的 prerender）。
- Dev server／瀏覽器驗證：`npm run dev` 啟動後：
  - `npm run jobs:intraday` 寫入 1 筆 tick；直接呼叫 `GET /api/jobs/intraday` 回 200 並正確 revalidate `intraday` tag。
  - `GET /api/jobs/daily` 因今日（2026-08-26）TWSE 盤後快照尚未發布，`hasTodaysSession()` 正確判斷為 false 並執行完整 pipeline（非阻塞、可重複呼叫，冪等）。
  - Playwright 截圖確認首頁 KPI 區塊：「加權指數 TAIEX · 盤中 13:33」顯示即時值 45,832.62 ▲663.16（+1.47%），頁首 note 顯示「盤中更新 13:33:00」，無 console error。
  - 驗證後已停止本次啟動的 dev server 程序。
- 第二階段驗證（方案 A 改動後重跑）：
  - `noCache` 有效性實測：同一 process 內連續 3 次 `fetchLatest()`，`requestsMade("mis.twse.com.tw")` 依序為 1／2／3，證明每次都真的發出請求（修正前會固定停在 1）。回傳 tick 值相同是因為今日已收盤（最後撮合 13:33）。
  - `taipeiToday()` 改動後重新 `lint`／`typecheck`／`build` 全過（build EXIT:0）。
  - 重啟 dev server 後 Playwright 取值：LABEL =「加權指數 TAIEX · 盤中 13:33」、NOTE =「盤中更新 13:33:00」、ERRORS = []，確認時區改動未破壞盤中徽章；截圖已看過。
  - 驗證後再次停掉 dev server 程序。
