import { test } from "node:test";
import assert from "node:assert/strict";
import {
  miIndexQuotes,
  tpexSnapshotQuotes,
  twseSnapshotQuotes,
  type TpexSnapshotRow,
  type TwseSnapshotRow,
} from "./market-data-provider";
import type { TwseTableResponse } from "./market-status-provider";
import { fixture } from "./__fixtures__/load";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// MI_INDEX type=ALLBUT0999 and the openapi mirror, captured 2026-11-17 16:35–16:38 Taipei.
const miIndex17 = fixture<TwseTableResponse>("mi-index-allbut0999-20261117.json");
const miIndex16 = fixture<TwseTableResponse>("mi-index-allbut0999-20261116.json");
const mirror16 = fixture<TwseSnapshotRow[]>("stock-day-all-1151116.json");
const tpex17 = fixture<TpexSnapshotRow[]>("tpex-close-1151117.json");

const all = (rows: string[][]) => new Set(rows.map((r) => r[0]));
const closeTable = (p: TwseTableResponse) => p.tables!.find((t) => t.title?.includes("每日收盤行情"))!;

test("MI_INDEX 每日收盤行情: thousands separators, HTML sign cell, '--' rows dropped", () => {
  const quotes = miIndexQuotes(miIndex17, all(closeTable(miIndex17).data!), day("2026-11-17"))!;
  const by = new Map(quotes.map((q) => [q.ticker, q]));

  assert.deepEqual(by.get("2317"), {
    ticker: "2317",
    date: day("2026-11-17"),
    open: 217,
    high: 227.5,
    low: 215,
    close: 219,
    volume: 54040998,
    change: 0.5, // <p style= color:red>+</p>
  });
  assert.equal(by.get("0050")?.change, -2.45); // <p style= color:green>-</p>
  // 00625K did not trade: every price is "--". No row, rather than a zero close.
  assert.equal(by.has("00625K"), false);
  // X (不比價) and a blank sign carry 0.00 and are stored as 0.
  assert.equal(by.get("006208")?.change, 0);
  assert.equal(by.get("00689R")?.change, 0);
});

test("MI_INDEX quotes are only the wanted tickers, dated with the session", () => {
  const quotes = miIndexQuotes(miIndex17, new Set(["2317", "2603"]), day("2026-11-17"))!;
  assert.deepEqual(
    quotes.map((q) => [q.ticker, q.date.toISOString().slice(0, 10), q.close]),
    [
      ["2317", "2026-11-17", 219],
      ["2603", "2026-11-17", 256.5],
    ],
  );
});

test("MI_INDEX table is found by title, not by its position among the ten tables", () => {
  const tables = [...miIndex17.tables!];
  const moved = { ...miIndex17, tables: [closeTable(miIndex17), ...tables.filter((t) => t !== closeTable(miIndex17))] };
  assert.equal(miIndexQuotes(moved, new Set(["2317"]), day("2026-11-17"))?.[0]?.close, 219);
});

test("MI_INDEX and the openapi mirror agree row for row on the same session", () => {
  // Switching the evening pull from the mirror to MI_INDEX must not change a
  // single stored value: same units (shares), same change for X / blank rows.
  const wanted = new Set(mirror16.map((r) => r.Code));
  const fromIndex = miIndexQuotes(miIndex16, wanted, day("2026-11-16"));
  const fromMirror = twseSnapshotQuotes(mirror16, wanted, day("2026-11-16"));
  assert.ok(fromMirror && fromMirror.length >= 5);
  assert.deepEqual(fromIndex, fromMirror);
});

test("a mirror still on the previous session yields nothing for the current one", () => {
  // At 16:35 on 11-17 STOCK_DAY_ALL still carried 11-16.
  assert.equal(twseSnapshotQuotes(mirror16, new Set(["2317"]), day("2026-11-17")), null);
});

test("MI_INDEX not published, or still on an earlier session, means 'not served yet'", () => {
  assert.equal(miIndexQuotes(fixture("mi-margn-20261117-not-published.json"), new Set(["2317"]), day("2026-11-17")), null);
  assert.equal(miIndexQuotes(miIndex16, new Set(["2317"]), day("2026-11-17")), null);
});

test("MI_INDEX answering a LATER session than asked is rejected, not stored", () => {
  assert.throws(() => miIndexQuotes(miIndex17, new Set(["2317"]), day("2026-11-16")), /answered 2026-11-17/);
});

test("TPEx close: shares, signed change with trailing blanks, '---' rows dropped", () => {
  const quotes = tpexSnapshotQuotes(tpex17, new Set(tpex17.map((r) => r.SecuritiesCompanyCode)), day("2026-11-17"))!;
  const by = new Map(quotes.map((q) => [q.ticker, q]));
  assert.deepEqual(by.get("6488"), {
    ticker: "6488",
    date: day("2026-11-17"),
    open: 544,
    high: 575,
    low: 535,
    close: 546,
    volume: 10450392,
    change: -31,
  });
  assert.equal(by.get("8299")?.change, 20);
  assert.equal(by.has("00758B"), false);
});

test("TPEx ahead of a session resolved from the lagging mirror contributes nothing", () => {
  // FMTQIK unreachable -> session 11-16 from the mirror, while TPEx already
  // serves 11-17: mixing them would store two sessions in one run.
  assert.equal(tpexSnapshotQuotes(tpex17, new Set(["6488"]), day("2026-11-16")), null);
});
