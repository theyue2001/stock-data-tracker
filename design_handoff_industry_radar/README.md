# Handoff: Taiwan Stock Industry Radar（台股產業雷達）

## Overview
A desktop-first, institutional-grade investment research dashboard for Taiwan stock investors. Core idea: **detect industry changes before the stock-price move becomes obvious**. Seven screens (總覽, 產業雷達, 資金流向, 個股雷達, 領先指標, 每日簡報, 追蹤清單) plus a per-industry detail view (產業細節), all in Traditional Chinese. The interface emphasizes *changes and transitions* (rank moves, indicator inflections, flow reversals) over static values.

## About the Design Files
`Taiwan Industry Radar.dc.html` is a **design reference created in HTML** — a working prototype showing intended look and behavior, NOT production code to copy directly. The task is to **recreate this design in the target codebase** — `stock-data-tracker` (Next.js App Router + Tailwind CSS v4 + TypeScript) — using its established patterns. If starting fresh, Next.js + Tailwind is the intended stack.

File anatomy (readable directly):
- The `<x-dc>` template section = all markup, one inline-styled block per screen (screens are wrapped in `<sc-if>` conditionals; repeated rows in `<sc-for>` loops; `{{ x }}` are data holes).
- The `class Component` script = all data models (`IND`, `STK`, `SIG`, `FLOW`, `DET`), color/formatting helpers, and interaction state.
- `modernist-styles.css` = the source design-system token sheet (Modernist) the dark theme was derived from. Reference for the accent ramp; do not link it as-is (it is the light theme).

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interactions are final — recreate pixel-perfectly. All market data is **fictional placeholder content** (dated 2026/08/21); wire to real data sources during implementation. Numbers, statuses, and copy show intended formats.

## Design Tokens

### Color (dark theme, derived from Modernist system)
Ground / surfaces
- App background: `#171514` (warm ink)
- Panel / card / sidebar: `#1d1b1a`
- Card border + row hairline: `rgba(243,242,242,.12)` 1px
- Strong section rule: `rgba(243,242,242,.32)` 2px (every section starts with one — Modernist signature)
- Text primary: `#f3f2f2`; secondary `rgba(243,242,242,.55)`; muted labels `rgba(243,242,242,.4–.45)`

Semantic (Taiwan convention — NEVER western: red = up, green = down)
- Up / inflow / improving: `#ff5a3d` (values), `#ff8a70` (words), `#ffc4b8` (text on tinted bg)
- Down / outflow / deteriorating: `#3dae7c` (values), `#6cc79d` (words)
- Overheat / risk warning: `#e6b23a` (marks), `#e6c26a` (text)
- Accent (actions, active nav, brand mark): `#ff563c` — active nav = solid `#ff563c` fill with `#171514` text
- Row highlight (big rank jump): `rgba(255,86,60,.06)`
- Selection: `rgba(255,86,60,.35)`; links `#ff563c`, hover `#ff9783`

### Typography
- **Archivo** (400–900): all Latin text and every number. Numbers always get `font-variant-numeric: tabular-nums`.
- **Noto Sans TC** (400/500/700/900): all CJK text (falls through the stack `Archivo,'Noto Sans TC',sans-serif`).
- **IBM Plex Mono** (400–600): tickers, timestamps, rank deltas (▲2/▼1/—), and letterspaced English kickers (e.g. `INDUSTRY HEAT RANKING`, 9px, letter-spacing .16em, 40% alpha).
- Scale: 22px/900 page titles · 20px/700–800 KPI values · 15px/700 card titles · 13–13.5px table primary · 11.5px/500 secondary cells · 10px/500 table headers (45% alpha) · 9–9.5px mono micro-labels.
- **Radius 0 everywhere. No shadows.** Structure is drawn entirely with rules and borders (Modernist).

### Spacing
- Screen padding: `0 24px 24px`; screen header `padding: 18px 0 12px`
- Section gap 16–18px; grid gaps 14px (cards) / 24px (main↔rail)
- Row padding: 8px vertical (標準 density) / 5px (緊湊 density — user setting)
- Card padding 14px 16px (compact variant 12px 14px in detail rail)

## Page Structure

App shell: fixed left sidebar **200px** (`#1d1b1a`, 1px right hairline) + scrollable content column. `min-width: 1280px`; app fills `100vh`, content column is the scroll container.

Sidebar: brand block (14px red square, 台股產業雷達, mono kicker `INDUSTRY RADAR`) over 2px rule; 7 nav items (label + mono index 01–07); footer date block above 1px rule. Active item = solid red fill; inactive hover = `rgba(243,242,242,.06)`.

### 1. 總覽 (Overview)
Answers: where is money flowing, what's strengthening/weakening, what changed. Layout top→bottom: title row (+ regime chip `多頭延續 · 類股輪動加速`), optional red rotation poster (tweak-gated), 6-cell KPI strip (TAIEX, OTC, 成交金額, 外資, 投信, 風險溫度 — cells separated by 1px hairlines, 2px rule top), then grid `1fr 336px`:
- Left: 產業熱度排行 — top-8 table (columns: ☆ 26px, 排名 52px w/ mono delta, 產業 1fr, 熱度 148px = 84px bar + score, 趨勢 44px arrow, 資金流 92px, 領先指標 92px, 狀態 100px badge). Row click → 產業細節. Below: 最弱產業 strip + 主題監測 chips (延續 = red outline, 過熱 = amber outline).
- Right rail: 領先指標異動 (4 rows: name + source/date mono ↔ value + change), 資金輪動 (流出 green-bordered box → arrow → 流入 red-tinted box), 風險與催化 (7px square dot: amber/red/neutral + line).

### 2. 產業雷達 (Industry Radar)
13 industry cards, 3-col grid, readable in 2–3s. Filter chips (全部/加速中/轉強/早期轉強/盤整/過熱/轉弱) + sort (依熱度/依排名變化). Card: name + ☆ + status badge / heat score 30px + trend arrow + rank delta + `RANK #n` / 4px heat bar / 2×2 momentum grid (資金流, 領先指標, 基本面動能, 技術面動能 — label:value rows with hairline underlines) / 催化 line / 風險 line. Whole card clicks → 產業細節; hover = accent border `rgba(255,86,60,.55)`.

### 3. 資金流向 (Capital Flow)
4-cell KPI strip (外資/投信/自營商/融資餘額) → 產業資金熱圖: 13 rows × columns (產業 104px, 外資/投信/自營/融資增速/量能 84px tinted cells, 周轉率 68px plain, 5日累計 = centered diverging bar + value). Industry name clicks → detail. Bottom: rotation panel `1fr auto 1fr` (流出 box → 大盤量能 note → 流入 box).
**Cell tint formula**: `alpha = .05 + min(|v|/scale, 1) × .3`; positive `rgba(255,86,60,α)` (text `#ff9783`, or `#ffc4b8` when |v|/scale > .5), negative `rgba(61,174,124,α)` (text `#6cc79d`). Scales: 外資 90, 投信 15, 自營 3.5, 融資 3, 量能 60. Diverging bar: half-width = `min(|d5|/230, 1) × 100%` of its side, 8px tall, green left / red right of a 1px center axis.

### 4. 個股雷達 (Stock Radar)
32-stock table with **column groups** separated by 2px vertical rules: 市場・籌碼 (☆, 個股 [name+ticker+industry], 價格, 漲跌 sortable, 量, 法人動向 2-line) ‖ 基本面體質 (營收動能, EPS) ‖ 短線強度 (RS sortable, 技術, 位階) ‖ 訊號 (催化 ellipsis, 狀態 badge). Group label row sits above the header row. Industry filter chips + `★ 僅看追蹤` toggle. Sorting: click 漲跌/RS header — first click sorts desc (▼), second flips (▲). Footnote row explains RS / 位階 / sorting. **No buy/sell labels anywhere** — fundamental quality and short-term strength stay visually separate.

### 5. 領先指標 (Leading Indicators)
29 indicator cards, 3-col grid, group filter chips (全部/航運/記憶體/光通訊/AI 伺服器/散熱/PCB / CCL/矽晶圓/封測/被動元件/半導體設備/面板/原物料/金融; row wraps). Card: name + mono group tag + direction badge / current value 22px + unit + change (colored) / 12-point SVG sparkline / source ↔ update-date mono footer.
**Sparkline spec**: `viewBox="0 0 280 64"`, `preserveAspectRatio="none"`, x from 4 to 276, y padding 6/6, polyline `stroke-width 1.6`, end dot `r 2.6`. Color by improvement flag: improving `#ff5a3d`, deteriorating `#3dae7c`, flat `rgba(243,242,242,.55)` — *improvement, not direction* (e.g. falling inventory weeks = red/improving).

### 6. 每日簡報 (Daily Brief)
Reading column `max-width: 920px`. Header: title + `2026/08/21 FRI · 20:00 生成` + legend of the three analytical tags. Ten numbered sections (mono `01`–`10`, 48px left column, 2px rule per section): 市場摘要, 資金輪動, 最強/最弱產業, 重要指標變化, 法人動向, 新興主題, 監測個股, 過熱區, 主要風險, 明日觀察. Every bullet is prefixed by exactly one 36px tag:
- **事實** (known fact): bg `rgba(255,86,60,.16)`, text `#ff9783`
- **推論** (reasonable inference): 1px border `rgba(243,242,242,.35)`, text 70% alpha
- **風險** (uncertainty/risk): bg `rgba(230,178,58,.14)`, text `#e6c26a`
明日觀察 uses plain mono `·` bullets.

### 7. 追蹤清單 (Watchlist)
`max-width: 1080px`. Three sections: 重要變化 (alert rows: 7px red square + text + mono time), 追蹤產業 (rows: ★ remove, name, 熱度+delta, trend, 資金流, badge), 追蹤個股 (rows: ★, name+ticker+industry, price, change, RS, 外資, badge). Empty states explain where to star items.

### 8. 產業細節 (Industry Detail — not in sidebar)
Reached from overview rows, radar cards, flow heatmap names. `← 產業雷達` back link. Header: name 22px + status badge + ☆ + `HEAT RANK #n`. 6-cell KPI strip: 熱度分數 (+delta), 趨勢, 主流狀態, 資金流強度, 循環位置, 風險等級 (color: 高 `#e6b23a`, 中高 `#e6c26a`, 低 `#6cc79d`, 中 80% white). Grid `1fr 320px`: left = 產業論點 thesis paragraph (13px/1.9, max 640px) + 領先指標 cards (2-col, compact); right rail = 相關個股 (compact rows with ☆/price/chg/RS/外資/badge) + 催化與風險 panel. All 13 industries have full content (thesis, 2–6 indicator series, stocks).

## Component System

- **Section header**: 2px top rule → `flex baseline`: zh title 700 13px + EN mono kicker + optional right-aligned muted note. Used identically on every panel.
- **KPI strip**: N-column grid, 2px rule top + 1px rule bottom, cells split by 1px hairlines; cell = 10px label / 20px value / 11px sub-line.
- **Status badges** (10.5px, padding 3px 8px, radius 0): 加速中 bg `rgba(255,86,60,.2)` text `#ffc4b8` · 轉強/趨勢確認 bg `rgba(255,86,60,.11)` text `#ff9783` · 早期轉強/潛在補漲 1px border `rgba(255,86,60,.55)` text `#ff9783` · 盤整/中性 border `rgba(243,242,242,.3)` text 65% · 過熱 bg `rgba(230,178,58,.16)` text `#e6c26a` · 高檔整理 border `rgba(230,178,58,.5)` text `#e6c26a` · 轉弱 bg `rgba(61,174,124,.14)` text `#6cc79d`. Compact rail variant: 9.5px / 2px 7px.
- **Filter chip**: 11.5px, padding 4px 11px; default 1px border `rgba(243,242,242,.3)` text 70%; active solid `#ff563c` fill, `#171514` text, weight 700; hover border `rgba(255,86,60,.6)`.
- **Heat bar**: 4px track `rgba(243,242,242,.12)`; fill width = score%; color: ≥80 `#ff563c`, 70–79 `rgba(255,86,60,.7)`, 60–69 `rgba(255,86,60,.42)`, else `rgba(243,242,242,.3)`; overrides — status 過熱 → `#e6b23a`, 轉弱 → `#3dae7c`.
- **Trend arrows**: ↑↗→↘↓; ↑↗ `#ff5a3d`, → 60% white, ↘↓ `#3dae7c`.
- **Rank delta**: mono 9.5px `▲n` red / `▼n` green / `—` 35% white.
- **Word coloring helper**: strength words (強勁流入, 中等流入, 改善中, 改善, 強, 轉強, 加速, 上修, 多頭, 突破) → `#ff8a70`; weakness words (流出, 惡化, 疲弱, 弱, 轉弱, 減速, 下修, 空頭, 低檔) → `#6cc79d`; else 55% white.
- **Watch star**: ☆ 35% white → ★ `#ff563c`; click always `stopPropagation` (rows/cards behind it navigate).
- **Row hover**: `rgba(243,242,242,.05)` on interactive table rows; heatmap industry names turn `#ff8a70`.

## Interactions & State

State: `screen` ('overview'|'radar'|'flow'|'stocks'|'indicators'|'brief'|'watch'|'detail'), `detail` (industry name, default 貨櫃航運), `rf` (radar status filter), `rsort` ('heat'|'delta'), `sf` (stock industry filter), `sg` (indicator group filter), `sortKey` ('chg'|'rs') + `sortDir` (−1 desc default, toggles), `watchOnly` (bool), `watch` (Set).

- Sidebar nav sets `screen`; when `screen === 'detail'` the 產業雷達 item stays active.
- Detail navigation: overview row / radar card / heatmap name → `{screen:'detail', detail:<name>}`; back link → radar.
- **Watchlist persistence**: `localStorage['tsir-watch']` = JSON array; keys = stock ticker (`"2603"`) or `"i:"+industry` (`"i:光通訊"`). Toggling updates storage immediately; survives reload.
- Radar filter 盤整 matches both 盤整 and 中性 statuses.
- User settings (implement as user preferences): `defaultScreen` (initial tab), `density` (標準 8px / 緊湊 5px row padding), `rotationPoster` (show red rotation banner on overview, default off).
- No animations/transitions in v1; hover states only. Focus states: 2px `#ff563c` outline, offset 2px (from the Modernist system).

## Data Models (see `class Component` in the DC file for full seed data)
- `IND[13]` industries: `{n, h (0–100), t (arrow), d (rank Δ), flow, lead, fund, tech, cat, risk, st}`
- `STK[32]` stocks: `{tk, n, ind, p, c (%), v, fa/fd (foreign ±億/streak), ta (trust), rv/rk (revenue % / 加速|穩定|減速), ep (上修|持平|下修), rs (0–100), te (多頭|整理|空頭), po (突破|高檔|中段|低檔), cat, st}`
- `SIG[29]` indicators: `{grp, n, cur, unit, chg, imp (1|0|−1), dir, src, upd, pts[12]}`
- `FLOW[13]`: `{n, fa, ta, da, mg, to, ve, d5}` (億 / % values for the heatmap)
- `DET` map: `{ms (主流狀態), cyc (循環位置), rl (風險等級), th (thesis)}` per industry; group mapping 貨櫃航運→航運, 半導體封測→封測, otherwise group = industry name.

## Responsive Behavior
Desktop-first, designed at 1440–1600px, `min-width: 1280px`. Below 1280 the layout holds and the page scrolls horizontally — it does not reflow. Tablet/mobile reflow is intentionally out of scope for this handoff.

## Assets
No images. Brand mark = plain red square (`#ff563c`). Fonts via Google Fonts (Archivo, Noto Sans TC, IBM Plex Mono). Charts are inline SVG polylines (no chart library needed; any lib must match the sparkline spec). If icons are added later, use Lucide (design-system convention).

## Assumptions
1. All market data is fictional (2026/08/21 close); statuses/scores illustrate the intended analytical vocabulary — the scoring engine is a backend concern.
2. Red = rise / green = fall is a hard requirement (Taiwan convention), applied to every semantic color decision including indicator "improvement".
3. UI language is Traditional Chinese; English appears only as mono micro-kickers and data-source names.
4. Statuses are analytical states, never buy/sell recommendations.
5. The 每日簡報 is generated nightly at 20:00 TST; the three-tag taxonomy (事實/推論/風險) must be preserved in any generated content.

## Files
- `Taiwan Industry Radar.dc.html` — the full high-fidelity prototype (template = markup/screens; `class Component` = data + interaction logic). Open inside the design workspace to run it; as a plain file it is the authoritative markup/style/logic reference.
- `modernist-styles.css` — Modernist design-system token sheet (accent ramp source; light-theme reference only).
- `SCREENSHOTS.md` + `screenshots/` — annotated captures of all screens and key interaction states (populated/empty watchlist, starred state, sorted table, rank-jump highlight).
