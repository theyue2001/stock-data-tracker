import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMisIndexPayload, type MisResponse } from "./intraday-provider";

// Shape observed on 2026-11-17 after the close (values other than d/t/tlong illustrative).
const TLONG_1333 = "1794893580000"; // 2026-11-17 13:33:00 Taipei
const closing = (msg: Record<string, string | undefined> = {}, top: Partial<MisResponse> = {}): MisResponse => ({
  rtcode: "0000",
  rtmessage: "OK",
  userDelay: 5000,
  msgArray: [{ d: "20261117", t: "13:33:00", tlong: TLONG_1333, z: "27000.50", y: "26900.25", h: "27100.00", l: "26850.75", ...msg }],
  ...top,
});

test("the observed closing tick parses with its exact instant", () => {
  assert.equal(Date.parse("2026-11-17T13:33:00+08:00"), Number(TLONG_1333));
  const [tick] = parseMisIndexPayload(closing());
  assert.equal(tick.date.toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(tick.index, "TAIEX");
  assert.equal(tick.last, 27000.5);
  assert.equal(tick.high, 27100);
  assert.equal(tick.low, 26850.75);
  assert.equal(tick.tickAt, "13:33:00");
  assert.equal(tick.tickEpochMs, 1794893580000);
  assert.ok(Math.abs(tick.change - 100.25) < 1e-9);
  assert.ok(Math.abs(tick.changePct - (100.25 / 26900.25) * 100) < 1e-9);
});

test("a non-0000 rtcode is an error, not an empty result", () => {
  assert.throws(() => parseMisIndexPayload(closing({}, { rtcode: "5000", rtmessage: "Error" })), /rtcode 5000 \(Error\)/);
  assert.throws(() => parseMisIndexPayload(closing({}, { rtcode: undefined })), /rtcode \(missing\)/);
  assert.throws(() => parseMisIndexPayload({ rtcode: "0000", msgArray: [] }), /no row/);
});

test("a session date the TWSE calendar says did not trade is rejected", () => {
  // Saturday
  assert.throws(() => parseMisIndexPayload(closing({ d: "20261121" })), /not a trading day/);
  // Christmas 2026 is a TWSE holiday
  assert.throws(() => parseMisIndexPayload(closing({ d: "20261225" })), /not a trading day/);
  assert.throws(() => parseMisIndexPayload(closing({ d: "2026-11-17" })), /no usable session date/);
});

test("a tick instant on a different Taipei day than its session is rejected", () => {
  const nextMorning = String(Date.parse("2026-11-18T09:00:05+08:00"));
  assert.throws(() => parseMisIndexPayload(closing({ tlong: nextMorning })), /falls on 2026-11-18 \(Taipei\), not on its session 2026-11-17/);
});

test("no trade yet ('-') yields nothing — never the prior close or a zero", () => {
  assert.deepEqual(parseMisIndexPayload(closing({ z: "-" })), []);
  assert.deepEqual(parseMisIndexPayload(closing({ z: "-", h: "-", l: "-" })), []);
  assert.deepEqual(parseMisIndexPayload(closing({ z: undefined })), []);
});

test("the tick instant falls back to d + t as Taipei time, and t to the instant", () => {
  const [fromT] = parseMisIndexPayload(closing({ tlong: undefined }));
  assert.equal(fromT.tickEpochMs, 1794893580000);
  const [fromTlong] = parseMisIndexPayload(closing({ t: undefined }));
  assert.equal(fromTlong.tickAt, "13:33:00");
  assert.throws(() => parseMisIndexPayload(closing({ t: undefined, tlong: undefined })), /no usable tick time/);
});
