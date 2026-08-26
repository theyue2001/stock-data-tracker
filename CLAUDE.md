@AGENTS.md

## 溝通語言

與使用者對話一律使用繁體中文回覆，不論使用者輸入訊息所用的語言為何。程式碼、commit message、識別字等技術產出維持原有慣例（英文），僅對使用者的說明文字套用此規則。

## Project Overview

股票／指標資料追蹤儀表板。Next.js 16（App Router + Cache Components）＋ React 19 ＋ TypeScript，Prisma＋PostgreSQL（Neon，`.env` 指向正式環境，本地 seed／reset 前務必確認）。UI 用 Tailwind CSS 4＋base-ui／shadcn 元件、Recharts 畫圖表。排程工作（alerts／brief／refresh／backfill）以 tsx script 執行，見 `scripts/`。

## 工作流

1. 依需求先定位相關模組／目錄，避免一開始就全域深掃源碼。
2. 查 `git log` 了解近期變更，避免與進行中的工作衝突。
3. 修改完成後啟動 dev server，實際在瀏覽器操作驗證過再回報完成。

## Architecture

### 進入點速查

| 要修改什麼 | 從這裡開始 |
| --- | --- |
| 頁面／路由 | `src/app/` |
| 共用 UI 元件 | `src/components/` |
| 資料查詢／聚合邏輯 | `src/lib/queries.ts` |
| 圖表／雷達圖繪製邏輯 | `src/lib/radar-ui.ts` |
| DB schema／migration | `prisma/` |
| 排程／資料匯入 script | `scripts/`（`cron.ts` 為總入口） |
| Prisma client 產生碼 | `src/generated/`（勿手動編輯） |

## 編碼規範

- 命名慣例：檔案／目錄用 kebab-case，React 元件用 PascalCase，一般變數／函式用 camelCase（沿用現有程式碼慣例）。
- Lint／格式：`npm run lint`（eslint-config-next），型別檢查 `npm run typecheck`。
- 日誌：避免遺留除錯用 `console.log`；排程 script 的執行紀錄走既有 logger／console 慣例即可。

## 驗收關卡（宣稱完成前必過）

1. 已啟動 dev server 並在瀏覽器實際操作驗證（或對應的測試指令已跑過）。
2. `npm run lint` 與 `npm run typecheck` 無錯誤；涉及 build 產出時 `npm run build` 也需過。
3. 證據已記錄：任務檔「驗證狀態」欄含修改檔案清單、執行的操作與觀察結果。
4. 不要在未執行驗證的情況下宣稱「已完成／已修復」。

## 授權邊界

- 預估變更超過 200 行、或涉及核心架構時，先提 Action Plan 取得確認再動手。
- 不讀取、不引用 secrets／credentials／tokens／signing material（只記錄 path pattern）。
- `.env` 指向正式 Neon 資料庫：任何 `db:reset`／`db:seed`／`db:migrate` 等具破壞性的指令，執行前先確認目標環境並取得使用者同意。

## Git 規則

- 主要開發分支：`master`；在主幹分支上時先切任務分支 `<type>/<slug>` 再提交。
- Commit 格式：`<type>(<slug>): <中文描述>`；type：feat／fix／docs／style／refactor／test／chore／perf。
- 安全 Merge：不直接在目標分支 merge，先建 `temp/merge-{來源分支}` 驗證，確認後才合入。

## 任務狀態檔（`.claude/tasks/`）

多步驟任務開始時建立 `.claude/tasks/<slug>.md`，固定四欄：目標／已完成／下一步／驗證狀態。任務結束後移至 `.claude/tasks/done/`。範本見 `.claude/tasks/_TEMPLATE.md`。

跨專案通用的溝通風格／Git 安全預設／授權界線已寫在全域 `~/.claude/CLAUDE.md`，這裡不重複。
