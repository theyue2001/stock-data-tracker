import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTaipei,
  nextIntradayDelayMs,
  nextIntradayTickAt,
  resolveIntradayInterval,
  taipeiInstant,
} from "./intraday-cadence";

// Taipei is UTC+8 with no DST: 09:00 Taipei = 01:00Z, 13:30 = 05:30Z, 13:35 = 05:35Z.
const next = (iso: string, interval = 60) => nextIntradayTickAt(new Date(iso), interval).toISOString();

test("taipeiInstant maps Taipei wall-clock time to a fixed UTC+8 instant", () => {
  assert.equal(new Date(taipeiInstant("2026-11-17", 9 * 60)).toISOString(), "2026-11-17T01:00:00.000Z");
  assert.equal(formatTaipei(new Date("2026-11-17T05:33:00Z")), "2026-11-17 13:33:00");
});

test("before the open on a trading day, the next tick is today's 09:00", () => {
  assert.equal(next("2026-11-17T00:00:00Z"), "2026-11-17T01:00:00.000Z");
  assert.equal(nextIntradayDelayMs(new Date("2026-11-17T00:00:00Z"), 60), 3600_000);
  // 00:30 Taipei, still the previous UTC date
  assert.equal(next("2026-11-17T16:30:00Z"), "2026-11-18T01:00:00.000Z");
});

test("during the session, ticks fall on the grid counted from 09:00:00", () => {
  assert.equal(next("2026-11-17T02:15:30Z"), "2026-11-17T02:16:00.000Z");
  assert.equal(next("2026-11-17T05:29:00Z", 45), "2026-11-17T05:29:15.000Z");
  assert.equal(next("2026-11-17T01:00:05Z", 10), "2026-11-17T01:00:10.000Z");
});

test("a timer that fires on, or a hair before, its grid point does not tick twice", () => {
  assert.equal(next("2026-11-17T02:16:00.000Z"), "2026-11-17T02:17:00.000Z");
  assert.equal(next("2026-11-17T02:15:59.700Z"), "2026-11-17T02:17:00.000Z");
});

test("after the last grid point of the session comes one final tick at 13:35", () => {
  // 13:30:00 is the close itself, not a session tick
  assert.equal(next("2026-11-17T05:29:10Z"), "2026-11-17T05:35:00.000Z");
  assert.equal(next("2026-11-17T05:32:00Z"), "2026-11-17T05:35:00.000Z");
});

test("after the final tick the collector sleeps until the next trading day's open", () => {
  assert.equal(next("2026-11-17T05:35:00.000Z"), "2026-11-18T01:00:00.000Z");
  assert.equal(next("2026-11-17T08:30:00Z"), "2026-11-18T01:00:00.000Z");
});

test("weekends and exchange holidays are skipped", () => {
  // Friday after close -> Monday
  assert.equal(next("2026-11-20T06:00:00Z"), "2026-11-23T01:00:00.000Z");
  // Saturday mid-"session"
  assert.equal(next("2026-11-21T03:00:00Z"), "2026-11-23T01:00:00.000Z");
  // Thu 2026-12-24 after close; Fri 12-25 is a TWSE holiday
  assert.equal(next("2026-12-24T07:00:00Z"), "2026-12-28T01:00:00.000Z");
  // On the holiday itself, during what would be the session
  assert.equal(next("2026-12-25T02:00:00Z"), "2026-12-28T01:00:00.000Z");
  // Lunar New Year 2027: closed 02-02 .. 02-10
  assert.equal(next("2027-02-01T08:00:00Z"), "2027-02-11T01:00:00.000Z");
});

test("INTRADAY_INTERVAL_SECONDS defaults to 60 and is clamped up to the providers' floor", () => {
  assert.deepEqual(resolveIntradayInterval(undefined, 60), { seconds: 60, requested: 60, floor: 60, clamped: false });
  assert.deepEqual(resolveIntradayInterval("", 60), { seconds: 60, requested: 60, floor: 60, clamped: false });
  assert.deepEqual(resolveIntradayInterval("10", 60), { seconds: 60, requested: 10, floor: 60, clamped: true });
  assert.deepEqual(resolveIntradayInterval("120", 60), { seconds: 120, requested: 120, floor: 60, clamped: false });
  // A licensed 10 s feed alone would allow 10 s
  assert.deepEqual(resolveIntradayInterval("10", 10), { seconds: 10, requested: 10, floor: 10, clamped: false });
});

test("an invalid INTRADAY_INTERVAL_SECONDS falls back to the default, never to zero", () => {
  assert.deepEqual(resolveIntradayInterval("abc", 60), { seconds: 60, requested: null, floor: 60, clamped: false });
  assert.deepEqual(resolveIntradayInterval("-5", 0), { seconds: 60, requested: null, floor: 0, clamped: false });
  assert.deepEqual(resolveIntradayInterval("0", 0), { seconds: 60, requested: null, floor: 0, clamped: false });
  assert.equal(resolveIntradayInterval("0.2", 0).seconds, 1);
});
