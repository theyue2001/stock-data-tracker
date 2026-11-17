import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeFlows,
  parseT86,
  parseTpexFlows,
  parseTpexMargin,
  parseTwseMargin,
  type TpexTableResponse,
} from "./flow-provider";
import type { TwseTableResponse } from "./market-status-provider";
import { NotPublishedError } from "@/lib/providers/errors";
import { fixture } from "./__fixtures__/load";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOV17 = day("2026-11-17");

const notPublished = (session: string) => (err: unknown) =>
  err instanceof NotPublishedError && err.session === session;

test("T86 published: foreign includes the foreign-dealer book; columns found by name", () => {
  const flows = parseT86(fixture("t86-20261117.json"), NOV17);
  // 2317: 外陸資 -3,329,158 + 外資自營商 0; 投信 866,466; 自營商 2,834,471
  assert.deepEqual(flows.get("2317"), {
    foreignNetShares: -3329158,
    trustNetShares: 866466,
    dealerNetShares: 2834471,
  });
  assert.equal(flows.size, 4);
});

test("T86 'no data' before publication is NotPublishedError, never zero-filled rows", () => {
  // The exact stat T86 answered at 16:07 on the session day (2026-11-17).
  assert.throws(() => parseT86({ stat: "很抱歉，沒有符合條件的資料!" }, NOV17), notPublished("2026-11-17"));
  // ...and the same shape as captured from MI_MARGN at 16:36.
  assert.throws(() => parseT86(fixture("mi-margn-20261117-not-published.json"), NOV17), notPublished("2026-11-17"));
});

test("T86 for another session is rejected: earlier = not published yet, later = error", () => {
  const t86 = fixture<TwseTableResponse>("t86-20261117.json");
  assert.throws(() => parseT86(t86, day("2026-11-18")), notPublished("2026-11-18"));
  assert.throws(
    () => parseT86(t86, day("2026-11-16")),
    (err: unknown) => !(err instanceof NotPublishedError) && /answered 2026-11-17/.test((err as Error).message),
  );
});

test("MI_MARGN: per-stock financing change in 張; not published -> NotPublishedError", () => {
  const margin = parseTwseMargin(fixture("mi-margn-20261116.json"), day("2026-11-16"));
  assert.equal(margin.get("2317"), 51159 - 50690);
  assert.equal(margin.get("2382"), 15820 - 16167);
  assert.throws(
    () => parseTwseMargin(fixture("mi-margn-20261117-not-published.json"), NOV17),
    notPublished("2026-11-17"),
  );
  // Yesterday's report must not stand in for today's.
  assert.throws(() => parseTwseMargin(fixture("mi-margn-20261116.json"), NOV17), notPublished("2026-11-17"));
});

test("TPEx 三大法人: positions verified by the report's own 合計 identities", () => {
  const insti = fixture<TpexTableResponse>("tpex-insti-20261117.json");
  const flows = parseTpexFlows(insti, NOV17);
  assert.deepEqual(flows.get("6488"), {
    foreignNetShares: 2464301,
    trustNetShares: -1684235,
    dealerNetShares: 174619,
  });

  // Drop one column: every position after it shifts and the identities break.
  const shifted: TpexTableResponse = {
    ...insti,
    tables: insti.tables!.map((t) =>
      t.data ? { ...t, data: t.data.map((r) => [...r.slice(0, 9), ...r.slice(10), "0"]) } : t,
    ),
  };
  assert.throws(() => parseTpexFlows(shifted, NOV17), /合計 identities/);
});

test("TPEx margin with an empty table for the session is NotPublishedError", () => {
  assert.throws(
    () => parseTpexMargin(fixture("tpex-margin-20261117-not-published.json"), NOV17),
    notPublished("2026-11-17"),
  );
  // The table is dated 115/11/17; asking about another day is a mismatch.
  assert.throws(() => parseTpexMargin(fixture("tpex-margin-20261117-not-published.json"), day("2026-11-16")));
});

test("TPEx 三大法人 dated another session is rejected", () => {
  assert.throws(() => parseTpexFlows(fixture("tpex-insti-20261117.json"), day("2026-11-18")), notPublished("2026-11-18"));
});

test("mergeFlows: absence from a PUBLISHED report is a zero; absence from both is no row", () => {
  const flows = new Map([["2317", { foreignNetShares: -3329158, trustNetShares: 866466, dealerNetShares: 2834471 }]]);
  const margin = new Map([
    ["2317", 469],
    ["2603", -184],
  ]);
  const rows = mergeFlows(
    [
      { ticker: "2317", exchange: "TWSE" },
      { ticker: "2603", exchange: "TWSE" },
      { ticker: "9999", exchange: "TWSE" },
    ],
    NOV17,
    [flows],
    [margin],
  );
  assert.deepEqual(
    rows.map((r) => [r.ticker, r.foreignNet, r.trustNet, r.dealerNet, r.marginChange, r.unit]),
    [
      ["2317", -3329158, 866466, 2834471, 469, "shares"],
      ["2603", 0, 0, 0, -184, "shares"],
    ],
  );
  assert.ok(rows.every((r) => r.date.getTime() === NOV17.getTime()));
});
