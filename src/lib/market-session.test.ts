import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarCovers,
  expectedLatestSession,
  isTradingDay,
  marketPhase,
  previousTradingDay,
  sessionKey,
  sessionString,
  taipeiNow,
} from "./market-session";

// Taipei is UTC+8 with no DST: 09:00 Taipei = 01:00Z.
const at = (iso: string) => new Date(iso);

test("taipeiNow converts an instant to the Taipei calendar day", () => {
  assert.deepEqual(taipeiNow(at("2026-11-16T16:30:00Z")), { date: "2026-11-17", minutes: 30 });
  assert.deepEqual(taipeiNow(at("2026-11-17T05:30:00Z")), { date: "2026-11-17", minutes: 13 * 60 + 30 });
});

test("weekends and TWSE holidays do not trade", () => {
  assert.equal(isTradingDay("2026-11-17"), true); // Tue
  assert.equal(isTradingDay("2026-11-21"), false); // Sat
  assert.equal(isTradingDay("2026-12-25"), false); // 行憲紀念日 (Fri)
  assert.equal(isTradingDay("2026-02-12"), false); // 市場無交易，僅辦理結算交割
  assert.equal(isTradingDay("2026-02-23"), true); // first session after Lunar New Year
});

test("previousTradingDay skips weekends and holiday runs", () => {
  assert.equal(previousTradingDay("2026-11-16"), "2026-11-13"); // Mon → Fri
  assert.equal(previousTradingDay("2026-02-23"), "2026-02-11"); // across Lunar New Year
  assert.equal(previousTradingDay("2026-12-28"), "2026-12-24"); // Mon, Fri 12-25 closed
});

test("marketPhase follows the 09:00–13:30 session", () => {
  assert.equal(marketPhase(at("2026-11-17T00:59:00Z")), "pre-open");
  assert.equal(marketPhase(at("2026-11-17T01:00:00Z")), "open");
  assert.equal(marketPhase(at("2026-11-17T05:29:00Z")), "open");
  assert.equal(marketPhase(at("2026-11-17T05:30:00Z")), "post-close");
  assert.equal(marketPhase(at("2026-11-21T03:00:00Z")), "closed-day");
});

test("expectedLatestSession is today only after the close is published", () => {
  assert.equal(expectedLatestSession(at("2026-11-17T06:29:00Z")), "2026-11-16"); // 14:29 Taipei
  assert.equal(expectedLatestSession(at("2026-11-17T06:30:00Z")), "2026-11-17"); // 14:30 Taipei
  assert.equal(expectedLatestSession(at("2026-11-16T17:00:00Z")), "2026-11-16"); // 01:00 Taipei on the 17th
  assert.equal(expectedLatestSession(at("2026-11-21T03:00:00Z")), "2026-11-20"); // Saturday
  assert.equal(expectedLatestSession(at("2026-12-25T08:00:00Z")), "2026-12-24"); // holiday afternoon
});

test("session keys round-trip through the UTC-midnight storage key", () => {
  assert.equal(sessionKey("2026-11-17").toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(sessionString(sessionKey("2026-11-17")), "2026-11-17");
});

test("calendarCovers reports which years have a holiday table", () => {
  assert.equal(calendarCovers(2026), true);
  assert.equal(calendarCovers(2027), true);
  assert.equal(calendarCovers(2030), false);
});
