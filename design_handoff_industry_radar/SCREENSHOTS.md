# Annotated Screenshots

Captured from the prototype at 2026/08/21 seed data, rendered ~1300px logical width (captured at 0.7 zoom — measurements in annotations are the true CSS px values from the spec, not pixel-measured from these images). Read together with `README.md`; token values there are authoritative.

---

## 01-overview.png — 總覽
- **Hierarchy (top→bottom):** screen title row (22px/900 + regime chip) → 6-cell KPI strip → two-column work area `1fr 336px` (gap 24px) → 主題監測 chip strip.
- **KPI strip:** one 2px rule on top, 1px rule below, cells split by 1px hairlines. Cell = 10px label / 20px tabular value / 11px sub-line. Semantic color only on the value line (red +182.4, amber 偏熱).
- **Heat ranking table:** row grid `26px 52px 1fr 148px 44px 92px 92px 100px`, col-gap 6px, row padding 8px vertical (density 標準). Heat cell = 84×4px bar + score. Row 3 (光通訊) shows the **rank-jump highlight**: `rgba(255,86,60,.06)` full-row tint + mono `#8→#3` outline chip — reproduce exactly; it is the "change detection" signature.
- **Interactions:** whole row click → 產業細節; ☆ click toggles watch without navigating (stopPropagation); row hover `rgba(243,242,242,.05)`.
- **Right rail:** three stacked panels, each opening with the standard section header (2px rule + 13px zh title + 9px mono kicker). 資金輪動 boxes: outflow = green 1px border on transparent; inflow = red border + `rgba(255,86,60,.07)` fill.

## 02-industry-radar.png — 產業雷達
- Filter chips row sits under a 2px rule, `padding 12px 0`; active chip = solid `#ff563c` + ink text, hover = accent border. Right-aligned sort pair behaves as an exclusive segmented pair.
- Card grid `repeat(3, minmax(0,1fr))`, gap 14px. Card = `#1d1b1a`, 1px hairline border, padding 14px 16px, **radius 0**.
- Card internal stack (gap 10px): title row (15px name, ☆, badge right) → score row (30px heat, 17px trend arrow, mono rank delta, right mono `RANK #n`) → 4px heat bar → 2×2 momentum grid (label:value rows, hairline underlines) → 催化 → 風險 (60% alpha).
- **Interactions:** entire card clicks → 產業細節 (`cursor:pointer`); hover = border `rgba(255,86,60,.55)`. Star excluded from navigation.
- Heat bar color encodes tiers (≥80 solid accent … <60 gray) with status overrides: 散熱 bar is amber (過熱), weak industries green.

## 03-industry-detail.png — 產業細節 (貨櫃航運)
- Not in sidebar; 產業雷達 nav item stays active. `← 產業雷達` back link (hover → `#ff8a70`).
- Header: 22px name + status badge + ☆ + right mono `HEAT RANK #1`.
- 6-cell KPI strip identical construction to overview strip. 風險等級 value is color-mapped (高 amber → 低 green).
- Body `1fr 320px`: thesis paragraph 13px/1.9 (max-width 640px) → 領先指標 compact cards in 2-col grid (chart height 52px vs 64px on the indicators screen — intentional compact variant, padding 12px 14px, badge 9.5px).
- Right rail: 相關個股 rows (☆ / name+ticker / compact badge; second line: price, chg, RS, 外資 — all 11px tabular) and 催化與風險 pairs with colored 催化/風險 micro-labels.
- Every industry (all 13) renders this full structure; indicator count varies 2–6.

## 04-capital-flow.png — 資金流向
- 4-cell institutional KPI strip → heatmap → rotation panel.
- **Heatmap grid** `104px 84px×4 68px 84px minmax(190px,1fr)`, col-gap 6px, rows separated by hairlines, cell padding 7px 8px. Tinted cells use the alpha formula (README → tint formula); 周轉率 column deliberately untinted (neutral density reference).
- **5日累計 diverging bar:** green grows leftward, red rightward from a 1px center axis, 8px tall; value right-aligned 44px, colored by sign. Bar half-width = `min(|d5|/230,1)×100%`.
- Industry names click → 產業細節 (hover `#ff8a70`). No row hover (tints carry the signal).
- Rotation panel `1fr auto 1fr`: outflow box → center arrow + context note → inflow box (same box language as overview rail, wider).

## 05-stock-radar.png — 個股雷達
- Shown sorted by 漲跌 desc (header ▼ active, accent-tinted header label = sortable affordance). Clicking 漲跌/RS toggles desc→asc.
- **Column-group separation is implementation-critical:** 2px vertical rules + `padding-left 10px` on the first column of each group (營收動能, RS, 催化), applied on the group-label row, header row, and every body row. Groups: 市場・籌碼 ‖ 基本面體質 ‖ 短線強度 ‖ 訊號.
- Row grid `26px 150px 64px 60px 62px 96px 80px 56px 44px 56px 56px minmax(140px,1fr) 92px`, col-gap 8px.
- Stock cell = name (12.5px/700) + mono ticker inline, industry 9.5px muted on line 2. 法人動向 = 2 lines (外資 colored by sign, 投信 muted).
- RS values ≥85 render accent red / ≤45 green; 催化 truncates with ellipsis; statuses are analytical badges — **no buy/sell language**.
- Industry filter chips (14) + `★ 僅看追蹤` toggle (right-aligned, same chip anatomy). Footnote row defines RS/位階/sorting.

## 06-indicators.png — 領先指標
- Group chips row wraps (`flex-wrap`); right-aligned legend: 紅＝改善 · 綠＝惡化/壓力 · 灰＝持平.
- Card grid 3-col, gap 14px. Card stack: name + mono group tag + direction badge → value row (22px value, 10.5px unit, colored change) → sparkline → mono source/date footer (9.5px, 38% alpha).
- **Sparkline spec (critical):** `viewBox 0 0 280 64`, `preserveAspectRatio="none"`, stroke 1.6, end dot r 2.6; y normalized to series min/max with 6px padding. Line color = improvement flag, **not** raw direction (falling 庫存週數 renders red/improving).

## 07-daily-brief-top.png / 08-daily-brief-bottom.png — 每日簡報
- Reading column `max-width 920px`. Header carries the tag legend (事實/推論/風險) — the three-tag system is a product requirement.
- Section anatomy: 2px rule → grid `48px 1fr` (mono section number, 16px/800, 30% alpha) → 14px title → tagged bullets.
- Bullet = 36px fixed-width tag + 12.5px/1.75 text at 85% alpha. Tag styles: 事實 red-tinted fill, 推論 neutral outline, 風險 amber-tinted fill.
- 明日觀察 (bottom capture) uses plain mono `·` bullets — watch items, not claims, so untagged.

## 09-overview-watch-starred.png — watch toggle state
- Two industries starred on 總覽: ☆ 35%-alpha → solid ★ `#ff563c`. State persists to `localStorage['tsir-watch']` immediately (keys `"i:"+產業名` / ticker).

## 10-watchlist-populated.png — 追蹤清單 (populated)
- 重要變化 alerts: 7px red square marker + text + right-aligned mono timestamp.
- 追蹤產業 rows: ★ (click = remove), name, 熱度+mono delta, trend arrow, 資金流 word, status badge — grid `26px 1fr 120px 44px 110px 110px`.
- Alert copy references entities inline with mono ticker/rank chips (`#8→#3`, `2368`).

## 11-watchlist-empty.png — 追蹤清單 (empty states)
- Both sections keep their headers; empty copy (11.5px, 45% alpha) tells the user where to star items. Alerts section still renders — it is system-driven, not watch-driven.
