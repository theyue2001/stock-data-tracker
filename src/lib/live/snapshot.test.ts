import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveSnapshot, dataStampOf, intradayIntervalSeconds, type IntradayRow, type LiveSources } from "./snapshot";

const taipei = (local: string) => new Date(`${local}+08:00`);

const row = (date: string, tickAt: string, updatedAt: string, last = 27_000): IntradayRow => ({
  date,
  last,
  change: 120.5,
  changePct: 0.45,
  high: 27_050,
  low: 26_900,
  tickAt,
  updatedAt: new Date(updatedAt).toISOString(),
  isMock: false,
});

const sources = (over: Partial<LiveSources> = {}): LiveSources => ({
  market: { session: "2026-11-16", isMock: false, createdAt: "2026-11-16T08:05:00.000Z" },
  pricesSession: "2026-11-16",
  lastRun: { id: "run-1", finishedAt: "2026-11-16T08:10:00.000Z" },
  intraday: null,
  ...over,
});

test("open session: the newer intraday tick is in the snapshot with its kind and age", () => {
  const s = buildLiveSnapshot(
    sources({ intraday: row("2026-11-17", "10:31:05", "2026-11-17T10:31:10+08:00") }),
    taipei("2026-11-17T10:31:30"),
    60,
  );
  assert.equal(s.phase, "open");
  assert.equal(s.expectedSession, "2026-11-16");
  assert.equal(s.close.stale, false);
  assert.deepEqual(
    { kind: s.intraday?.kind, age: s.intraday?.ageSeconds, tickDate: s.intraday?.tickDate, tickAt: s.intraday?.tickAt },
    { kind: "live", age: 25, tickDate: "2026-11-17", tickAt: "10:31:05" },
  );
});

test("an intraday tick for a session whose close is stored is left out", () => {
  const s = buildLiveSnapshot(
    sources({
      market: { session: "2026-11-17", isMock: false, createdAt: "2026-11-17T08:05:00.000Z" },
      pricesSession: "2026-11-17",
      intraday: row("2026-11-17", "13:33:00", "2026-11-17T13:34:00+08:00"),
    }),
    taipei("2026-11-17T16:10:00"),
    60,
  );
  assert.equal(s.intraday, null);
  assert.equal(s.close.stale, false);
});

test("staleness counts trading days and uses the older of close and prices", () => {
  const s = buildLiveSnapshot(sources({ pricesSession: "2026-11-13" }), taipei("2026-11-17T15:00:00"), 60);
  assert.equal(s.close.session, "2026-11-13");
  assert.equal(s.close.marketSession, "2026-11-16");
  assert.equal(s.close.behindTradingDays, 2);
  assert.equal(s.close.stale, true);
});

test("version moves with every tick; dataVersion only with after-hours data", () => {
  const now = taipei("2026-11-17T10:31:30");
  const a = buildLiveSnapshot(sources({ intraday: row("2026-11-17", "10:30:05", "2026-11-17T10:30:10+08:00") }), now, 60);
  const b = buildLiveSnapshot(sources({ intraday: row("2026-11-17", "10:31:05", "2026-11-17T10:31:10+08:00", 27_010) }), now, 60);
  assert.notEqual(a.version, b.version);
  assert.equal(a.dataVersion, b.dataVersion);

  const c = buildLiveSnapshot(sources({ lastRun: { id: "run-2", finishedAt: "2026-11-17T08:10:00.000Z" } }), now, 60);
  const d = buildLiveSnapshot(sources({ market: { session: "2026-11-17", isMock: false, createdAt: "x" } }), now, 60);
  assert.notEqual(c.dataVersion, a.dataVersion);
  assert.notEqual(d.dataVersion, a.dataVersion);
  // Deterministic: the same data always yields the same token.
  assert.equal(buildLiveSnapshot(sources(), now, 60).dataVersion, dataStampOf(sources()).dataVersion);
});

test("the data stamp falls back to the newest close row when no job run is logged", () => {
  const stamp = dataStampOf(sources({ lastRun: null }));
  assert.equal(stamp.lastUpdatedAt, "2026-11-16T08:05:00.000Z");
  assert.equal(dataStampOf({ market: null, pricesSession: null, lastRun: null }).session, null);
});

test("INTRADAY_INTERVAL_SECONDS: default 60, never below the collector's 60 s floor", () => {
  assert.equal(intradayIntervalSeconds({}), 60);
  assert.equal(intradayIntervalSeconds({ INTRADAY_INTERVAL_SECONDS: "120" }), 120);
  assert.equal(intradayIntervalSeconds({ INTRADAY_INTERVAL_SECONDS: "30" }), 60);
  assert.equal(intradayIntervalSeconds({ INTRADAY_INTERVAL_SECONDS: "abc" }), 60);
});
