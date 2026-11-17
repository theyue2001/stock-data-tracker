import { test } from "node:test";
import assert from "node:assert/strict";
import { NotPublishedError } from "../providers/errors";
import type { DatasetOutcome, DatasetStatus, DatasetStepResult } from "./run-log";
import {
  REQUIRED_DATASETS,
  STEP_ORDER,
  deadlineFor,
  executePlan,
  formatDeadline,
  mergeRun,
  parseDeadline,
  planRun,
  type PipelineDataset,
  type PlanOptions,
  type PlanState,
  type StepFn,
  type StepRecorder,
  type StepTable,
} from "./session-plan";

const SESSION = "2026-11-17"; // Tue
const OPTIONS: PlanOptions = { flowDeadlineMin: 21 * 60, bestEffortRetryMs: 60 * 60_000, detailRetryMs: 30 * 60_000 };
// Taipei = UTC+8: 16:10 Taipei = 08:10Z.
const at = (taipeiHm: string, day = SESSION) => {
  const [h, m] = taipeiHm.split(":").map(Number);
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((h - 8) * 60 + m) * 60_000);
};

function fresh(overrides: Partial<PlanState> = {}): PlanState {
  return { session: SESSION, previous: {}, thisRun: {}, scope: "all", force: false, ...overrides };
}

/** Every dataset's latest run succeeded at `when`. */
function allSucceeded(when: Date): PlanState["previous"] {
  return Object.fromEntries(STEP_ORDER.map((d) => [d, { status: "success" as DatasetStatus, at: when }]));
}

/**
 * Stand-in for JobRunHandle with the same contract: never throws,
 * NotPublishedError -> waiting, anything else -> failed.
 */
function recorder(): StepRecorder & { log: Array<[string, DatasetStatus]> } {
  const log: Array<[string, DatasetStatus]> = [];
  return {
    log,
    async dataset<T>(dataset: string, fn: () => Promise<{ value: T; outcome?: DatasetOutcome }>): Promise<DatasetStepResult<T>> {
      try {
        const { value, outcome = {} } = await fn();
        const status = outcome.status ?? "success";
        log.push([dataset, status]);
        return { status, ok: status !== "failed" && status !== "waiting", value };
      } catch (error) {
        const status: DatasetStatus = error instanceof NotPublishedError ? "waiting" : "failed";
        log.push([dataset, status]);
        return { status, ok: false, error };
      }
    },
    async record(dataset, outcome) {
      log.push([dataset, outcome.status]);
    },
  };
}

const succeed: StepFn = async () => ({ value: null });
const waiting: StepFn = async () => {
  throw new NotPublishedError("twse-tpex-institutional", SESSION);
};
const boom: StepFn = async () => {
  throw new Error("HTTP 503 from upstream");
};
/** scores / sentiment report partial while provisional, like the real steps. */
const derived: StepFn = async (d) => ({ value: null, outcome: { status: d.provisional ? "partial" : "success" } });

function steps(overrides: StepTable = {}): StepTable {
  const table: StepTable = Object.fromEntries(STEP_ORDER.map((d) => [d, succeed]));
  table.scores = derived;
  table.sentiment = derived;
  return { ...table, ...overrides };
}

const order = (log: Array<[string, DatasetStatus]>) => log.map(([d]) => d);
const statusOf = (log: Array<[string, DatasetStatus]>, d: PipelineDataset) => log.find(([x]) => x === d)?.[1];

// ---------------------------------------------------------------------------

test("deadline is the configured Taipei time on the session day", () => {
  assert.equal(deadlineFor(SESSION, 21 * 60).toISOString(), "2026-11-17T13:00:00.000Z");
  assert.equal(parseDeadline("21:00"), 1260);
  assert.equal(parseDeadline(" 7:05 "), 425);
  assert.equal(parseDeadline("25:00"), null);
  assert.equal(parseDeadline("9pm"), null);
  assert.equal(parseDeadline(undefined), null);
  assert.equal(formatDeadline(1260), "21:00");
});

test("a fresh session runs every dataset in dependency order", async () => {
  const rec = recorder();
  const run = await executePlan(rec, fresh(), at("17:00"), OPTIONS, steps());
  assert.deepEqual(order(rec.log), [...STEP_ORDER]);
  const after = planRun(mergeRun(run.state, at("17:00")), at("17:00"), OPTIONS);
  assert.equal(after.complete, true);
  assert.equal(after.settled, true);
  assert.equal(after.next, null);
});

test("a poll with nothing missing is a no-op", () => {
  const plan = planRun(fresh({ previous: allSucceeded(at("16:30")) }), at("16:35"), OPTIONS);
  assert.equal(plan.next, null);
  assert.equal(plan.complete, true);
  assert.equal(plan.settled, true);
});

test("complete prices are not refetched when only a later dataset is missing", () => {
  const previous = allSucceeded(at("16:30"));
  previous.brief = { status: "failed", at: at("16:30") };
  const plan = planRun(fresh({ previous }), at("16:35"), OPTIONS);
  assert.equal(plan.next?.dataset, "brief");
  assert.equal(plan.decisions.find((d) => d.dataset === "prices")?.action, "done");
  assert.equal(plan.decisions.filter((d) => d.action === "run").length, 1);
});

test("one failing dataset does not stop the others", async () => {
  const rec = recorder();
  const run = await executePlan(
    rec,
    fresh(),
    at("17:00"),
    OPTIONS,
    steps({ fundamentals: boom, catalysts: boom, sentiment: boom, alerts: boom }),
  );
  // Every step was still attempted except those that READ a failed one:
  // alerts and the brief need final sentiment, so they wait for the retry.
  assert.deepEqual(order(rec.log), [
    "market-status",
    "prices",
    "fundamentals",
    "catalysts",
    "flows",
    "indicators",
    "technicals",
    "scores",
    "sentiment",
  ]);
  assert.equal(statusOf(rec.log, "fundamentals"), "failed");
  assert.equal(statusOf(rec.log, "scores"), "success");
  const after = planRun(mergeRun(run.state, at("17:00")), at("17:05"), OPTIONS);
  assert.equal(after.decisions.find((d) => d.dataset === "alerts")?.action, "blocked");
  // Next poll retries the failed required dataset; best-effort ones wait out the cooldown.
  assert.equal(after.next?.dataset, "sentiment");
  assert.equal(after.decisions.find((d) => d.dataset === "fundamentals")?.action, "hold");
});

test("a failed alerts run still lets the brief run, and is retried next poll", async () => {
  const rec = recorder();
  const run = await executePlan(rec, fresh(), at("17:00"), OPTIONS, steps({ alerts: boom }));
  assert.equal(statusOf(rec.log, "alerts"), "failed");
  assert.equal(statusOf(rec.log, "brief"), "success");
  const after = planRun(mergeRun(run.state, at("17:00")), at("17:05"), OPTIONS);
  assert.equal(after.next?.dataset, "alerts");
  assert.equal(after.complete, false);
});

test("flows publish late: provisional scores now, final scores + alerts + brief when flows land", async () => {
  // 16:10 — close is out, T86 is not.
  const rec1 = recorder();
  const run1 = await executePlan(rec1, fresh(), at("16:10"), OPTIONS, steps({ flows: waiting }));
  assert.equal(statusOf(rec1.log, "flows"), "waiting");
  assert.equal(statusOf(rec1.log, "scores"), "partial");
  assert.equal(statusOf(rec1.log, "sentiment"), "partial");
  assert.equal(statusOf(rec1.log, "alerts"), undefined, "alerts wait for final scores");
  assert.equal(statusOf(rec1.log, "brief"), undefined);

  // 16:15 — still not out: only flows is retried; provisional scores are left alone.
  const s2 = mergeRun(run1.state, at("16:10"));
  const rec2 = recorder();
  const run2 = await executePlan(rec2, s2, at("16:15"), OPTIONS, steps({ flows: waiting }));
  assert.deepEqual(order(rec2.log), ["flows"]);

  // 16:40 — T86 is out: flows, then everything that reads them.
  const s3 = mergeRun(run2.state, at("16:15"));
  const rec3 = recorder();
  const run3 = await executePlan(rec3, s3, at("16:40"), OPTIONS, steps());
  assert.deepEqual(order(rec3.log), ["flows", "technicals", "scores", "sentiment", "alerts", "brief"]);
  assert.equal(statusOf(rec3.log, "scores"), "success");
  const after = planRun(mergeRun(run3.state, at("16:40")), at("16:45"), OPTIONS);
  assert.equal(after.complete, true);
  assert.equal(after.next, null);
});

test("after the flow deadline: one last call, then finalize without flows", async () => {
  const previous: PlanState["previous"] = {
    ...allSucceeded(at("16:10")),
    flows: { status: "waiting", at: at("20:55") },
    scores: { status: "partial", at: at("16:10") },
    sentiment: { status: "partial", at: at("16:10") },
  };
  delete previous.alerts;
  delete previous.brief;

  const plan = planRun(fresh({ previous }), at("21:00"), OPTIONS);
  assert.equal(plan.next?.dataset, "flows");
  assert.equal(plan.next?.lastCall, true);

  // The last call still finds nothing; the real step turns that into a failure.
  const rec = recorder();
  const run = await executePlan(rec, fresh({ previous }), at("21:00"), OPTIONS, steps({ flows: boom }));
  assert.deepEqual(order(rec.log), ["flows", "scores", "sentiment", "alerts", "brief"]);
  assert.equal(statusOf(rec.log, "scores"), "success", "finalized without flows");

  const after = planRun(mergeRun(run.state, at("21:00")), at("21:05"), OPTIONS);
  assert.equal(after.decisions.find((d) => d.dataset === "flows")?.action, "given-up");
  assert.equal(after.complete, false, "flows never succeeded");
  assert.equal(after.settled, true, "but nothing is left to wait for");
  assert.equal(after.next, null);
});

test("the first run after the deadline still gives flows a chance", async () => {
  // e.g. only the once-a-day safety-net cron fires, at 21:30.
  const rec = recorder();
  await executePlan(rec, fresh(), at("21:30"), OPTIONS, steps());
  assert.equal(statusOf(rec.log, "flows"), "success");
  assert.equal(statusOf(rec.log, "scores"), "success");
  assert.equal(statusOf(rec.log, "brief"), "success");
});

test("incomplete prices block everything that reads them and are retried", async () => {
  const partialPrices: StepFn = async () => ({ value: null, outcome: { status: "partial", note: "no TPEx prices yet" } });
  const rec = recorder();
  const run = await executePlan(rec, fresh(), at("16:05"), OPTIONS, steps({ prices: partialPrices }));
  assert.deepEqual(order(rec.log), ["market-status", "prices", "fundamentals", "catalysts", "indicators"]);
  const after = planRun(mergeRun(run.state, at("16:05")), at("16:10"), OPTIONS);
  assert.equal(after.next?.dataset, "prices");
  for (const d of ["flows", "technicals", "scores", "sentiment", "alerts", "brief"] as const) {
    assert.equal(after.decisions.find((x) => x.dataset === d)?.action, "blocked", d);
  }
});

test("market detail missing is retried on a cooldown until the deadline, then accepted", () => {
  const previous = allSucceeded(at("16:10"));
  previous["market-status"] = { status: "partial", at: at("16:10") };
  // Not every poll: each attempt is four requests to the rate-limited host.
  const soon = planRun(fresh({ previous }), at("16:15"), OPTIONS);
  assert.equal(soon.next, null);
  assert.equal(soon.decisions.find((d) => d.dataset === "market-status")?.action, "hold");
  assert.equal(soon.settled, false);
  // The session is scored meanwhile: the market row itself exists.
  assert.equal(soon.decisions.find((d) => d.dataset === "scores")?.action, "done");
  assert.equal(planRun(fresh({ previous }), at("16:40"), OPTIONS).next?.dataset, "market-status");

  // One last call at the deadline, even inside the cooldown.
  previous["market-status"] = { status: "partial", at: at("20:50") };
  assert.equal(planRun(fresh({ previous }), at("21:00"), OPTIONS).next?.dataset, "market-status");

  previous["market-status"] = { status: "partial", at: at("21:00") };
  const late = planRun(fresh({ previous }), at("21:05"), OPTIONS);
  assert.equal(late.next, null);
  assert.equal(late.settled, true);
});

test("a missing market row is retried every poll", () => {
  const plan = planRun(fresh({ previous: { "market-status": { status: "waiting", at: at("16:10") } } }), at("16:15"), OPTIONS);
  assert.equal(plan.next?.dataset, "market-status");
});

test("best-effort datasets run once per session and back off after a failure", () => {
  const previous = allSucceeded(at("16:30"));
  previous.catalysts = { status: "failed", at: at("16:30") };
  const soon = planRun(fresh({ previous }), at("16:45"), OPTIONS);
  assert.equal(soon.next, null);
  assert.equal(soon.decisions.find((d) => d.dataset === "catalysts")?.action, "hold");
  assert.equal(soon.complete, true, "best-effort datasets never block completeness");

  const later = planRun(fresh({ previous }), at("17:31"), OPTIONS);
  assert.equal(later.next?.dataset, "catalysts");
});

test("the refresh scope stops before alerts and the brief", async () => {
  const rec = recorder();
  const run = await executePlan(rec, fresh({ scope: "data" }), at("17:00"), OPTIONS, steps());
  assert.ok(!order(rec.log).includes("alerts"));
  assert.ok(!order(rec.log).includes("brief"));
  const after = planRun(mergeRun(run.state, at("17:00")), at("17:00"), OPTIONS);
  assert.equal(after.complete, true);
});

test("force re-runs every dataset once even when the session is complete", async () => {
  const rec = recorder();
  await executePlan(rec, fresh({ previous: allSucceeded(at("16:30")), force: true }), at("17:00"), OPTIONS, steps());
  assert.deepEqual(order(rec.log), [...STEP_ORDER]);
});

test("every required dataset is in the execution order", () => {
  for (const d of REQUIRED_DATASETS) assert.ok(STEP_ORDER.includes(d), d);
});
