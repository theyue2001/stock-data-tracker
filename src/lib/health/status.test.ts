import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HEALTH_CONFIG,
  activeGroups,
  datasetHealth,
  healthConfigFromEnv,
  overallHealth,
  parseClockMinutes,
  publicHealth,
  redactSecrets,
  tickInstant,
  tradingDaysBehind,
  worstStatus,
  type DatasetHealthInput,
} from "./status";

// Taipei is UTC+8 with no DST. 2026-11-17 is a Tuesday; 11-13 Fri, 11-16 Mon, 11-21 Sat.
const taipei = (local: string) => new Date(`${local}+08:00`);

function session(dataset: string, over: Partial<DatasetHealthInput> = {}): DatasetHealthInput {
  return { dataset, latest: null, latestSuccess: null, newestSuccessSession: null, expectedSessionStatus: null, ...over };
}
const attempt = (status: string, session: string | null = null, at = taipei("2026-11-17T16:00:00")) => ({
  status,
  session,
  startedAt: at,
  finishedAt: at,
});
const success = (session: string | null, at: Date) => ({ session, startedAt: at, finishedAt: at });

// ---------------------------------------------------------------------------
// Session datasets
// ---------------------------------------------------------------------------

test("session dataset: healthy only when a success covers the expected session", () => {
  const now = taipei("2026-11-17T17:00:00");
  const h = datasetHealth(session("prices", { latest: attempt("success", "2026-11-17"), newestSuccessSession: "2026-11-17" }), now);
  assert.equal(h.status, "healthy");
  assert.equal(h.expectedSession, "2026-11-17");
  assert.equal(h.sessionsBehind, 0);
});

test("session dataset: the latest attempt failing wins over older coverage", () => {
  const now = taipei("2026-11-17T17:00:00");
  const h = datasetHealth(session("prices", { latest: attempt("failed", "2026-11-17"), newestSuccessSession: "2026-11-17" }), now);
  assert.equal(h.status, "failed");
});

test("session dataset: waiting while the source has not published and the deadline is ahead", () => {
  const now = taipei("2026-11-17T17:00:00");
  const h = datasetHealth(
    session("flows", { latest: attempt("waiting", "2026-11-17"), newestSuccessSession: "2026-11-16", expectedSessionStatus: "waiting" }),
    now,
  );
  assert.equal(h.status, "waiting");
  assert.equal(h.deadline, "21:00");
  assert.equal(h.sessionsBehind, 1);
});

test("session dataset: not yet polled inside the publication window is waiting, not delayed", () => {
  const now = taipei("2026-11-17T15:00:00");
  const h = datasetHealth(session("prices", { latest: attempt("success", "2026-11-16"), newestSuccessSession: "2026-11-16" }), now);
  assert.equal(h.status, "waiting");
});

test("session dataset: waiting past the deadline becomes delayed", () => {
  const now = taipei("2026-11-17T21:30:00");
  const h = datasetHealth(
    session("flows", { latest: attempt("waiting", "2026-11-17"), newestSuccessSession: "2026-11-16", expectedSessionStatus: "waiting" }),
    now,
  );
  assert.equal(h.status, "delayed");
  assert.match(h.reason, /已過 21:00/);
});

test("session dataset: close-based datasets are late after 18:00, flow-dependent ones after the flow deadline", () => {
  const now = taipei("2026-11-17T19:00:00");
  const covered = { newestSuccessSession: "2026-11-16", latest: attempt("success", "2026-11-16") };
  assert.equal(datasetHealth(session("market-status", covered), now).status, "delayed");
  assert.equal(datasetHealth(session("scores", covered), now).status, "waiting");
  assert.equal(datasetHealth(session("brief", covered), now).deadline, "21:00");
});

test("session dataset: partial for the expected session is delayed", () => {
  const now = taipei("2026-11-17T17:00:00");
  const h = datasetHealth(
    session("prices", { latest: attempt("partial", "2026-11-17"), newestSuccessSession: "2026-11-16", expectedSessionStatus: "partial" }),
    now,
  );
  assert.equal(h.status, "delayed");
});

test("session dataset: more than one session behind is delayed even inside the window", () => {
  const now = taipei("2026-11-17T15:00:00");
  const h = datasetHealth(
    session("flows", { latest: attempt("waiting", "2026-11-17"), newestSuccessSession: "2026-11-13", expectedSessionStatus: "waiting" }),
    now,
  );
  assert.equal(h.status, "delayed");
  assert.equal(h.sessionsBehind, 2);
});

test("session dataset: never healthy without a success row", () => {
  const now = taipei("2026-11-17T10:00:00");
  assert.equal(datasetHealth(session("prices"), now).status, "delayed");
  assert.equal(datasetHealth(session("prices", { latest: attempt("skipped") }), now).status, "delayed");
  assert.equal(datasetHealth(session("prices", { latest: attempt("waiting") }), now).status, "delayed");
});

test("session dataset: on a weekend Friday must be in, no publication window applies", () => {
  const now = taipei("2026-11-21T10:00:00");
  assert.equal(datasetHealth(session("flows", { newestSuccessSession: "2026-11-20" }), now).status, "healthy");
  assert.equal(datasetHealth(session("flows", { newestSuccessSession: "2026-11-19" }), now).status, "delayed");
});

test("PIPELINE_FLOW_DEADLINE moves the flow deadline", () => {
  const config = healthConfigFromEnv({ PIPELINE_FLOW_DEADLINE: "20:30" });
  assert.equal(config.flowDeadlineMin, 20 * 60 + 30);
  const input = session("flows", { newestSuccessSession: "2026-11-16", expectedSessionStatus: "waiting" });
  assert.equal(datasetHealth(input, taipei("2026-11-17T20:45:00"), config).status, "delayed");
  assert.equal(datasetHealth(input, taipei("2026-11-17T20:15:00"), config).status, "waiting");
});

test("malformed env values fall back to the defaults", () => {
  assert.deepEqual(healthConfigFromEnv({ PIPELINE_FLOW_DEADLINE: "9pm", INTRADAY_INTERVAL_SECONDS: "-5" }), DEFAULT_HEALTH_CONFIG);
  // The collector clamps the MIS poll to >= 60 s, so the threshold does too.
  assert.equal(healthConfigFromEnv({ INTRADAY_INTERVAL_SECONDS: "30" }).intradayIntervalSeconds, 60);
  assert.equal(healthConfigFromEnv({ INTRADAY_INTERVAL_SECONDS: "120" }).intradayIntervalSeconds, 120);
  assert.equal(parseClockMinutes("24:00"), null);
  assert.equal(parseClockMinutes(" 7:05 "), 7 * 60 + 5);
});

// ---------------------------------------------------------------------------
// Intraday
// ---------------------------------------------------------------------------

const intraday = (tick: DatasetHealthInput["tick"], over: Partial<DatasetHealthInput> = {}) => session("intraday-index", { tick, ...over });
const tick = (date: string, tickAt: string) => ({ date, tickAt, updatedAt: taipei(`${date}T${tickAt}`) });

test("intraday: healthy while ticks are younger than three polls", () => {
  const h = datasetHealth(intraday(tick("2026-11-17", "10:00:00")), taipei("2026-11-17T10:02:30"));
  assert.equal(h.status, "healthy");
  assert.equal(h.ageSeconds, 150);
});

test("intraday: stale during the session is delayed, failed when the last poll failed", () => {
  const now = taipei("2026-11-17T10:05:00");
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "10:00:00")), now).status, "delayed");
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "10:00:00"), { latest: attempt("failed") }), now).status, "failed");
});

test("intraday: the threshold follows INTRADAY_INTERVAL_SECONDS", () => {
  const config = { ...DEFAULT_HEALTH_CONFIG, intradayIntervalSeconds: 300 };
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "10:00:00")), taipei("2026-11-17T10:05:00"), config).status, "healthy");
});

test("intraday: right after the open, yesterday's tick is waiting for the first print", () => {
  const h = datasetHealth(intraday(tick("2026-11-16", "13:30:00")), taipei("2026-11-17T09:01:00"));
  assert.equal(h.status, "waiting");
});

test("intraday: a collector logging `waiting` (feed still on the previous session) is waiting, not delayed", () => {
  const now = taipei("2026-11-17T09:20:00");
  assert.equal(datasetHealth(intraday(tick("2026-11-16", "13:30:00"), { latest: attempt("waiting") }), now).status, "waiting");
  assert.equal(datasetHealth(intraday(tick("2026-11-16", "13:30:00"), { latest: attempt("success") }), now).status, "delayed");
});

test("intraday: after hours only the session's closing tick matters, not its age", () => {
  const now = taipei("2026-11-17T18:00:00");
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "13:30:00")), now).status, "healthy");
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "13:26:00")), now).status, "healthy");
  assert.equal(datasetHealth(intraday(tick("2026-11-17", "11:02:00")), now).status, "delayed");
  assert.equal(datasetHealth(intraday(tick("2026-11-16", "13:30:00")), now).status, "delayed");
});

test("intraday: before the open and on closed days the previous session's close is enough", () => {
  assert.equal(datasetHealth(intraday(tick("2026-11-16", "13:30:00")), taipei("2026-11-17T08:00:00")).status, "healthy");
  assert.equal(datasetHealth(intraday(tick("2026-11-20", "13:30:00")), taipei("2026-11-22T12:00:00")).status, "healthy");
  assert.equal(datasetHealth(intraday(tick("2026-11-19", "13:30:00")), taipei("2026-11-22T12:00:00")).status, "delayed");
});

test("intraday: no stored tick is never healthy", () => {
  assert.equal(datasetHealth(intraday(null), taipei("2026-11-17T10:00:00")).status, "delayed");
  assert.equal(datasetHealth(intraday(null), taipei("2026-11-21T10:00:00")).status, "delayed");
});

// ---------------------------------------------------------------------------
// Periodic datasets
// ---------------------------------------------------------------------------

test("periodic: healthy with a success on one of the last two trading days", () => {
  const tue = taipei("2026-11-17T10:00:00");
  assert.equal(datasetHealth(session("indicators", { latestSuccess: success(null, taipei("2026-11-16T20:00:00")) }), tue).status, "healthy");
  assert.equal(datasetHealth(session("indicators", { latestSuccess: success(null, taipei("2026-11-13T20:00:00")) }), tue).status, "delayed");
  // Monday: Friday is still inside the window.
  const mon = taipei("2026-11-16T10:00:00");
  assert.equal(datasetHealth(session("catalysts", { latestSuccess: success(null, taipei("2026-11-13T20:00:00")) }), mon).status, "healthy");
  // The verify cron fires at 00:00 Taipei Tue–Sat; the Saturday run still counts on Monday, not on Tuesday.
  const satRun = { latestSuccess: success(null, taipei("2026-11-21T00:00:05")) };
  assert.equal(datasetHealth(session("verify", satRun), taipei("2026-11-23T10:00:00")).status, "healthy");
  assert.equal(datasetHealth(session("verify", satRun), taipei("2026-11-24T10:00:00")).status, "delayed");
});

test("periodic: failed latest attempt, waiting source, and no success at all", () => {
  const now = taipei("2026-11-17T10:00:00");
  const recent = success(null, taipei("2026-11-17T01:00:00"));
  assert.equal(datasetHealth(session("verify", { latest: attempt("failed"), latestSuccess: recent }), now).status, "failed");
  assert.equal(datasetHealth(session("fundamentals", { latest: attempt("waiting") }), now).status, "waiting");
  assert.equal(datasetHealth(session("fundamentals"), now).status, "delayed");
});

test("unknown datasets get the periodic rule", () => {
  const now = taipei("2026-11-17T10:00:00");
  assert.equal(datasetHealth(session("some-new-dataset", { latestSuccess: success(null, now) }), now).status, "healthy");
});

// ---------------------------------------------------------------------------
// Helpers and overall verdicts
// ---------------------------------------------------------------------------

test("tradingDaysBehind counts sessions, skipping weekends", () => {
  assert.equal(tradingDaysBehind("2026-11-13", "2026-11-17"), 2);
  assert.equal(tradingDaysBehind("2026-11-17", "2026-11-17"), 0);
  assert.equal(tradingDaysBehind(null, "2026-11-17"), null);
});

test("tickInstant reads the exchange time in Taipei", () => {
  assert.equal(tickInstant("2026-11-17", "13:30:00")?.toISOString(), "2026-11-17T05:30:00.000Z");
  assert.equal(tickInstant("2026-11-17", "9:01")?.toISOString(), "2026-11-17T01:01:00.000Z");
  assert.equal(tickInstant("2026-11-17", "--"), null);
});

test("worstStatus orders failed > delayed > waiting > healthy", () => {
  assert.equal(worstStatus([]), "healthy");
  assert.equal(worstStatus(["healthy", "waiting"]), "waiting");
  assert.equal(worstStatus(["waiting", "failed", "delayed"]), "failed");
});

test("activeGroups drops a provider that another provider replaced over a day ago", () => {
  const groups = [
    { dataset: "prices", provider: "mock-market-data", latestAttemptAt: taipei("2026-11-13T16:00:00") },
    { dataset: "prices", provider: "twse-tpex-prices", latestAttemptAt: taipei("2026-11-17T16:00:00") },
    { dataset: "verify", provider: "twse-fmtqik", latestAttemptAt: taipei("2026-11-17T00:00:00") },
    { dataset: "verify", provider: "tpex-close", latestAttemptAt: taipei("2026-11-17T00:00:03") },
  ];
  assert.deepEqual(
    activeGroups(groups).map((g) => g.provider),
    ["twse-tpex-prices", "twse-fmtqik", "tpex-close"],
  );
});

test("overall: inside the publication window the site is waiting but ok", () => {
  const now = taipei("2026-11-17T15:00:00");
  const o = overallHealth({ latestSession: "2026-11-16", datasets: [{ dataset: "prices", status: "waiting", attempted: true }] }, now);
  assert.equal(o.status, "waiting");
  assert.equal(o.ok, true);
  assert.equal(o.behindTradingDays, 1);
});

test("overall: a stored session behind the deadline is delayed", () => {
  const o = overallHealth({ latestSession: "2026-11-16", datasets: [] }, taipei("2026-11-17T19:00:00"));
  assert.equal(o.status, "delayed");
  assert.equal(o.ok, false);
  assert.equal(overallHealth({ latestSession: null, datasets: [] }, taipei("2026-11-17T19:00:00")).ok, false);
});

test("public health: only attempted required datasets can fail it", () => {
  const now = taipei("2026-11-17T17:00:00");
  const base = { latestSession: "2026-11-17", tick: null };
  const ok = publicHealth(
    {
      ...base,
      datasets: [
        { dataset: "alerts", status: "failed", attempted: true },
        { dataset: "scores", status: "delayed", attempted: false },
        { dataset: "prices", status: "healthy", attempted: true },
      ],
    },
    now,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.status, "healthy");
  const failed = publicHealth({ ...base, datasets: [{ dataset: "prices", status: "failed", attempted: true }] }, now);
  assert.equal(failed.ok, false);
  assert.equal(failed.status, "failed");
  // The admin page counts every logged dataset, required or not ...
  assert.equal(overallHealth({ latestSession: "2026-11-17", datasets: [{ dataset: "alerts", status: "failed", attempted: true }] }, now).status, "failed");
  // ... but not one no job has ever logged.
  assert.equal(overallHealth({ latestSession: "2026-11-17", datasets: [{ dataset: "technicals", status: "delayed", attempted: false }] }, now).status, "healthy");
});

test("public health: shape carries no internals", () => {
  const now = taipei("2026-11-17T10:00:45");
  const body = publicHealth({ latestSession: "2026-11-16", datasets: [], tick: tick("2026-11-17", "10:00:00") }, now);
  assert.deepEqual(Object.keys(body).sort(), [
    "behindTradingDays",
    "checkedAt",
    "expectedSession",
    "intraday",
    "latestSession",
    "ok",
    "phase",
    "status",
  ]);
  assert.deepEqual(body.intraday, { tickDate: "2026-11-17", tickAt: "10:00:00", ageSeconds: 45 });
  assert.equal(body.phase, "open");
  assert.equal(body.checkedAt, now.toISOString());
});

test("redactSecrets masks tokens, bearer headers and connection-string passwords", () => {
  assert.equal(
    redactSecrets("HTTP 402 from https://api.finmindtrade.com/api/v4/data?dataset=X&token=abc.def-123&data_id=2330"),
    "HTTP 402 from https://api.finmindtrade.com/api/v4/data?dataset=X&token=***&data_id=2330",
  );
  assert.equal(redactSecrets("sent Authorization: Bearer s3cr3t-value"), "sent Authorization: Bearer ***");
  assert.equal(redactSecrets("connect postgresql://app:hunter2@db.example:5432/x failed"), "connect postgresql://app:***@db.example:5432/x failed");
  assert.equal(redactSecrets("HTTP 503 from https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK"), "HTTP 503 from https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK");
});
