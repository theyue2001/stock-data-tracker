import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionResolver,
  parseBreadth,
  parseFmtqik,
  parseInstitutional,
  parseMarginChange,
  sessionProbeUrl,
  type SessionResolverDeps,
  type TwseTableResponse,
} from "./market-status-provider";
import { fixture } from "./__fixtures__/load";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

// FMTQIK for November as served at 16:36 Taipei on 2026-11-17.
const fmtqik = fixture<TwseTableResponse>("fmtqik-20261117.json");

test("parseFmtqik reads index close, signed change and NT$ turnover by column name", () => {
  const sessions = parseFmtqik(fmtqik);
  assert.deepEqual(
    sessions.map((s) => iso(s.date)),
    ["2026-11-13", "2026-11-16", "2026-11-17"],
  );
  const last = sessions.at(-1)!;
  assert.equal(last.close, 40092.11);
  assert.equal(last.change, -947.97);
  // 成交金額, not 成交股數 (14,624,794,027).
  assert.equal(last.volume, 997737877197);
});

test("parseFmtqik drops a row with a missing change instead of zero-filling it", () => {
  const payload = { ...fmtqik, data: fmtqik.data!.map((r, i) => (i === 2 ? [...r.slice(0, 5), "--"] : r)) };
  assert.deepEqual(
    parseFmtqik(payload).map((s) => iso(s.date)),
    ["2026-11-13", "2026-11-16"],
  );
});

test("parseFmtqik treats a 'no data' month as no sessions", () => {
  assert.deepEqual(parseFmtqik(fixture("mi-margn-20261117-not-published.json")), []);
  assert.deepEqual(parseFmtqik(null), []);
});

// --- session resolution ----------------------------------------------------

/** 16:40 Taipei on 2026-11-17. */
const AFTER_CLOSE = new Date("2026-11-17T08:40:00Z");

function resolverWith(overrides: Partial<SessionResolverDeps>, clock = { now: AFTER_CLOSE }) {
  const calls = { fmtqik: 0, mirror: 0, warnings: [] as string[] };
  const deps: SessionResolverDeps = {
    fetchFmtqik: async () => fmtqik,
    // The openapi mirror at 16:35 on 11-17 still carried 11-16.
    fetchMirrorDate: async () => day("2026-11-16"),
    now: () => clock.now,
    warn: (m) => calls.warnings.push(m),
    ...overrides,
  };
  const counted: SessionResolverDeps = {
    ...deps,
    fetchFmtqik: (now) => {
      calls.fmtqik++;
      return deps.fetchFmtqik(now);
    },
    fetchMirrorDate: () => {
      calls.mirror++;
      return deps.fetchMirrorDate();
    },
  };
  return { resolver: createSessionResolver(counted, 60_000), calls };
}

test("FMTQIK current beats the lagging mirror, and the mirror is not even asked", async () => {
  const { resolver, calls } = resolverWith({});
  const session = await resolver.resolve();
  assert.equal(iso(session?.date), "2026-11-17");
  assert.equal(session?.via, "fmtqik");
  assert.equal(session?.core?.close, 40092.11);
  assert.deepEqual([calls.fmtqik, calls.mirror], [1, 0]);
});

test("FMTQIK is asked for the Taipei month, not the UTC one", () => {
  // 2026-11-30 23:30Z is already 12-01 07:30 in Taipei.
  assert.match(sessionProbeUrl(new Date("2026-11-30T23:30:00Z")), /FMTQIK\?date=20261201&response=json$/);
  assert.match(sessionProbeUrl(AFTER_CLOSE), /FMTQIK\?date=20261117&/);
});

test("a month with no published session yet falls back to the mirror without a warning", async () => {
  const { resolver, calls } = resolverWith({
    fetchFmtqik: async () => fixture("mi-margn-20261117-not-published.json"),
  });
  const session = await resolver.resolve();
  assert.equal(iso(session?.date), "2026-11-16");
  assert.equal(session?.via, "openapi-mirror");
  assert.equal(session?.core, null);
  assert.deepEqual(calls.warnings, []);
});

test("a failed or blocked FMTQIK falls back to the mirror with a warning", async () => {
  const { resolver, calls } = resolverWith({
    fetchFmtqik: async () => {
      throw new Error("TWSE has temporarily blocked this client");
    },
  });
  const session = await resolver.resolve();
  assert.equal(iso(session?.date), "2026-11-16");
  assert.equal(session?.via, "openapi-mirror");
  assert.equal(calls.warnings.length, 1);
  assert.match(calls.warnings[0], /FMTQIK unavailable/);
});

test("an FMTQIK 404 counts as a failure, not as an empty month", async () => {
  const { resolver, calls } = resolverWith({ fetchFmtqik: async () => null });
  assert.equal((await resolver.resolve())?.via, "openapi-mirror");
  assert.equal(calls.warnings.length, 1);
});

test("both sources failing resolves to null, never to a guessed date", async () => {
  const { resolver } = resolverWith({
    fetchFmtqik: async () => {
      throw new Error("ECONNRESET");
    },
    fetchMirrorDate: async () => {
      throw new Error("ECONNRESET");
    },
  });
  assert.equal(await resolver.resolve(), null);
});

test("one request per memo period, shared by concurrent callers, fresh after it", async () => {
  const clock = { now: AFTER_CLOSE };
  const { resolver, calls } = resolverWith({}, clock);
  await Promise.all([resolver.resolve(), resolver.resolve(), resolver.resolve()]);
  clock.now = new Date(AFTER_CLOSE.getTime() + 59_000);
  await resolver.resolve();
  assert.equal(calls.fmtqik, 1);

  clock.now = new Date(AFTER_CLOSE.getTime() + 60_000);
  await resolver.resolve();
  assert.equal(calls.fmtqik, 2);
});

// --- per-session detail ------------------------------------------------------

test("breadth counts listed STOCKS, not the warrant-dominated whole market", () => {
  const ms = fixture<TwseTableResponse>("mi-index-ms-20261117.json");
  assert.deepEqual(parseBreadth(ms, day("2026-11-17")), { advancers: 234, decliners: 789 });
});

test("breadth from another session's report is discarded, not stored under the wrong date", () => {
  const ms = fixture<TwseTableResponse>("mi-index-ms-20261117.json");
  assert.equal(parseBreadth(ms, day("2026-11-18")), null);
});

test("BFI82U splits foreign / trust / dealer so they reconcile to the report's 合計", () => {
  const bfi = fixture<TwseTableResponse>("bfi82u-20261117.json");
  const net = parseInstitutional(bfi, day("2026-11-17"));
  assert.deepEqual(net, { foreignNet: -38093637.437, trustNet: -934960.749, dealerNet: -15696495.525 });
  const total = net!.foreignNet! + net!.trustNet! + net!.dealerNet!;
  assert.ok(Math.abs(total - -54725093.711) < 1e-6);
});

test("a BFI82U row that is missing leaves its field null instead of summing to zero", () => {
  const bfi = fixture<TwseTableResponse>("bfi82u-20261117.json");
  const withoutTrust = { ...bfi, data: bfi.data!.filter((r) => !r[0].startsWith("投信")) };
  assert.equal(parseInstitutional(withoutTrust, day("2026-11-17"))?.trustNet, null);
});

test("MI_MARGN not yet published leaves margin null; a published one yields the 融資金額 delta", () => {
  assert.equal(parseMarginChange(fixture("mi-margn-20261117-not-published.json"), day("2026-11-17")), null);
  const published = fixture<TwseTableResponse>("mi-margn-20261116.json");
  assert.equal(parseMarginChange(published, day("2026-11-16")), 524497993 - 536598906);
  // The 11-16 report asked about 11-17 must not pass as 11-17's margin.
  assert.equal(parseMarginChange(published, day("2026-11-17")), null);
});
