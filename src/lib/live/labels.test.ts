import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTaiex, freshness, mmddWeekday, staleText, taipeiStamp, tradingDaysBetween, type IntradayTick } from "./labels";

// Taipei is UTC+8 with no DST: 10:31:30 Taipei = 02:31:30Z.
// 2026-11-17 is a Tuesday (trading day); 2026-11-16 the trading day before.
const taipei = (local: string) => new Date(`${local}+08:00`);
const tick = (date: string, tickAt: string, updatedAt = `${date}T${tickAt || "00:00:00"}+08:00`): IntradayTick => ({
  date,
  tickAt,
  updatedAt: new Date(updatedAt).toISOString(),
});
const label = (closeSession: string | null, intraday: IntradayTick | null, now: Date | null, intervalSeconds = 60) =>
  describeTaiex({ closeSession, intraday, intervalSeconds }, now);

test("open, fresh tick → 即時 with the exchange tick time", () => {
  const l = label("2026-11-16", tick("2026-11-17", "10:31:05"), taipei("2026-11-17T10:31:30"));
  assert.deepEqual(l, { source: "intraday", kind: "live", text: "即時 10:31:05", session: "2026-11-17", ageSeconds: 25 });
});

test("the 即時 window is exactly 2 × the poll interval", () => {
  const t = tick("2026-11-17", "10:00:00");
  assert.equal(label("2026-11-16", t, taipei("2026-11-17T10:02:00"))?.kind, "live"); // 120 s
  assert.equal(label("2026-11-16", t, taipei("2026-11-17T10:02:01"))?.kind, "delayed"); // 121 s
  assert.equal(label("2026-11-16", t, taipei("2026-11-17T10:00:21"), 10)?.kind, "delayed"); // 21 s > 2 × 10 s
});

test("open, old tick → 延遲 with its age and tick time", () => {
  const l = label("2026-11-16", tick("2026-11-17", "10:20:00"), taipei("2026-11-17T10:31:30"));
  assert.equal(l?.kind, "delayed");
  assert.equal(l?.text, "延遲（11 分鐘前）· 10:20:00");
  assert.equal(l?.ageSeconds, 690);
  assert.equal(label("2026-11-16", tick("2026-11-17", "10:00:00"), taipei("2026-11-17T10:00:25"), 10)?.text, "延遲（25 秒前）· 10:00:00");
  assert.equal(label("2026-11-16", tick("2026-11-17", "09:00:00"), taipei("2026-11-17T11:05:00"))?.text, "延遲（2 小時前）· 09:00:00");
});

test("a tick time ahead of the clock never yields a negative age", () => {
  assert.equal(label("2026-11-16", tick("2026-11-17", "10:31:40"), taipei("2026-11-17T10:31:30"))?.ageSeconds, 0);
});

test("after 13:30, close not stored yet → the last intraday print, never called the close", () => {
  const l = label("2026-11-16", tick("2026-11-17", "13:33:00"), taipei("2026-11-17T14:10:00"));
  assert.equal(l?.source, "intraday");
  assert.equal(l?.kind, "last-tick");
  assert.equal(l?.text, "盤中最後一筆 13:33（收盤資料尚未入庫）");
});

test("a tick from an earlier session whose close never landed carries its date", () => {
  const l = label("2026-11-16", tick("2026-11-17", "13:33:00"), taipei("2026-11-18T08:00:00"));
  assert.equal(l?.kind, "last-tick");
  assert.equal(l?.text, "盤中最後一筆 11/17 13:33（收盤資料尚未入庫）");
  // Same during the next session's open, before its first tick lands.
  assert.equal(label("2026-11-16", tick("2026-11-17", "13:33:00"), taipei("2026-11-18T09:05:00"))?.kind, "last-tick");
});

test("once the session's official close is stored, the close wins over its intraday tick", () => {
  const l = label("2026-11-17", tick("2026-11-17", "13:33:00"), taipei("2026-11-17T16:10:00"));
  assert.deepEqual(l, { source: "close", kind: "close", text: "收盤 11/17", session: "2026-11-17", ageSeconds: null });
  // During the next open, yesterday's tick is superseded by yesterday's close.
  assert.equal(label("2026-11-17", tick("2026-11-17", "13:33:00"), taipei("2026-11-18T09:05:00"))?.kind, "previous-close");
});

test("pre-open, weekend and holiday → 前一交易日收盤", () => {
  assert.equal(label("2026-11-17", null, taipei("2026-11-18T08:00:00"))?.text, "前一交易日收盤 11/17"); // Wed pre-open
  assert.equal(label("2026-11-20", null, taipei("2026-11-21T11:00:00"))?.text, "前一交易日收盤 11/20"); // Saturday
  assert.equal(label("2026-12-24", null, taipei("2026-12-25T11:00:00"))?.text, "前一交易日收盤 12/24"); // 行憲紀念日
  // Market open but no tick (poller down): still the previous close, never 即時.
  assert.equal(label("2026-11-16", null, taipei("2026-11-17T10:00:00"))?.kind, "previous-close");
});

test("a close older than the previous trading day is dated, not called the previous close", () => {
  const l = label("2026-11-13", null, taipei("2026-11-18T10:00:00"));
  assert.equal(l?.kind, "older-close");
  assert.equal(l?.text, "收盤 11/13");
});

test("without a clock (prerender) only always-true labels are produced", () => {
  assert.deepEqual(label("2026-11-16", tick("2026-11-17", "10:31:05"), null), {
    source: "intraday",
    kind: null,
    text: "盤中 11/17 10:31:05",
    session: "2026-11-17",
    ageSeconds: null,
  });
  assert.deepEqual(label("2026-11-16", null, null), { source: "close", kind: null, text: "收盤 11/16", session: "2026-11-16", ageSeconds: null });
});

test("a tick the feed did not time-stamp falls back to when it was written", () => {
  const t = tick("2026-11-17", "", "2026-11-17T10:30:00+08:00");
  const l = label("2026-11-16", t, taipei("2026-11-17T10:31:00"));
  assert.equal(l?.text, "即時 10:30:00");
  assert.equal(l?.ageSeconds, 60);
});

test("no close and no tick → nothing to show", () => {
  assert.equal(label(null, null, taipei("2026-11-17T10:00:00")), null);
  assert.equal(label(null, tick("2026-11-17", "10:00:00"), taipei("2026-11-17T10:00:30"))?.kind, "live");
});

test("tradingDaysBetween counts trading days after `from` up to `to`", () => {
  assert.equal(tradingDaysBetween("2026-11-16", "2026-11-17"), 1);
  assert.equal(tradingDaysBetween("2026-11-17", "2026-11-17"), 0);
  assert.equal(tradingDaysBetween("2026-11-18", "2026-11-17"), 0);
  assert.equal(tradingDaysBetween("2026-11-13", "2026-11-17"), 2); // Fri → Tue across a weekend
  assert.equal(tradingDaysBetween("2026-12-23", "2026-12-28"), 2); // 12-24, (12-25 closed), 12-28
});

test("freshness is stale only once the expected session's close should be out", () => {
  assert.equal(freshness("2026-11-16", taipei("2026-11-17T14:29:00")).stale, false);
  assert.deepEqual(freshness("2026-11-16", taipei("2026-11-17T14:30:00")), {
    session: "2026-11-16",
    expectedSession: "2026-11-17",
    behindTradingDays: 1,
    stale: true,
  });
  // Mock data can run ahead of the calendar; that is not stale.
  assert.equal(freshness("2026-11-17", taipei("2026-11-17T10:00:00")).stale, false);
  assert.equal(freshness("2026-11-19", taipei("2026-11-23T10:00:00")).behindTradingDays, 1); // expects Fri 11-20
  assert.equal(freshness(null, taipei("2026-11-17T10:00:00")).stale, true);
});

test("staleText names both sessions with weekdays and the gap", () => {
  assert.equal(staleText(freshness("2026-11-16", taipei("2026-11-17T15:00:00"))), "資料停在 11/16（一），最新應為 11/17（二） · 落後 1 個交易日");
  assert.equal(staleText(freshness("2026-11-13", taipei("2026-11-17T15:00:00"))), "資料停在 11/13（五），最新應為 11/17（二） · 落後 2 個交易日");
  assert.equal(staleText(freshness("2026-11-17", taipei("2026-11-17T15:00:00"))), null);
  assert.equal(staleText(freshness(null, taipei("2026-11-17T15:00:00"))), "尚無收盤資料，最新應為 11/17（二）");
});

test("date formatting is pinned to Taipei whatever the runtime's zone", () => {
  assert.equal(mmddWeekday("2026-11-17"), "11/17（二）");
  assert.equal(taipeiStamp("2026-11-17T08:05:00Z"), "11/17 16:05");
  assert.equal(taipeiStamp("2026-11-17T16:30:00Z"), "11/18 00:30");
});
