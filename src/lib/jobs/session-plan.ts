import type { DatasetKey, DatasetOutcome, DatasetStatus, DatasetStepResult } from "./run-log";

/**
 * What the after-hours pipeline still has to do for one session, decided
 * from what the job log says has already happened.
 *
 * The old pipeline asked one yes/no question ("is the session stored?") and
 * then ran everything or nothing. That froze a session the moment MarketStatus
 * and most prices existed: flows that were published an hour later, a scores
 * pass that crashed, an alert run that threw — none of them were ever retried,
 * because the gate already said "stored". Here every dataset is tracked on its
 * own (the latest DatasetRun per dataset and session), and each poll runs only
 * the steps whose inputs are ready and whose output is not final yet.
 *
 * This file is deliberately free of database and provider imports: `planRun`
 * is a pure function of (state, now), and `executePlan` drives injected step
 * functions, so both can be tested without a database or a network.
 */

/** A session is complete when the latest run of every one of these is `success`. */
export const REQUIRED_DATASETS = [
  "market-status",
  "prices",
  "flows",
  "technicals",
  "scores",
  "sentiment",
  "alerts",
  "brief",
] as const satisfies readonly DatasetKey[];

/**
 * Not tied to the session's own publication (monthly revenue, filings, external
 * indicators): fetched at most once per session, never block completeness, and
 * a failure is retried only after a cooldown so a dead upstream is not hit on
 * every 5-minute poll.
 */
export const BEST_EFFORT_DATASETS = ["fundamentals", "catalysts", "indicators"] as const satisfies readonly DatasetKey[];

export type RequiredDataset = (typeof REQUIRED_DATASETS)[number];
export type BestEffortDataset = (typeof BEST_EFFORT_DATASETS)[number];
export type PipelineDataset = RequiredDataset | BestEffortDataset;

/**
 * Execution order. It is the dependency order, not a preference:
 *   prices -> flows         per-stock net buying is published in shares and is
 *                           valued at the stored session close
 *   fundamentals -> indicators  the ODM aggregate is derived from stored filings
 *   flows -> technicals     the technicals pass stamps breakoutCount onto the
 *                           industry flow row, so it must run after that row exists
 *   everything -> scores, sentiment  both read only what is stored
 *   scores, sentiment -> alerts -> brief  the brief quotes the alerts
 */
export const STEP_ORDER: readonly PipelineDataset[] = [
  "market-status",
  "prices",
  "fundamentals",
  "catalysts",
  "flows",
  "indicators",
  "technicals",
  "scores",
  "sentiment",
  "alerts",
  "brief",
];

/** "all" is the daily pipeline; "data" (the refresh job) stops before alerts and the brief. */
export type PlanScope = "all" | "data";

export interface DatasetState {
  status: DatasetStatus;
  /** When that run started. */
  at: Date;
}

export interface PlanState {
  /** YYYY-MM-DD session the run targets. */
  session: string;
  /** Latest recorded outcome per dataset for this session, from earlier runs. */
  previous: Partial<Record<PipelineDataset, DatasetState>>;
  /** Outcomes recorded so far in the current run. Each dataset runs at most once per run. */
  thisRun: Partial<Record<PipelineDataset, DatasetStatus>>;
  scope: PlanScope;
  /** Re-run every dataset once regardless of what is already complete (manual repair). */
  force: boolean;
}

export interface PlanOptions {
  /** Minutes after Taipei midnight, on the session day, after which flows (T86)
   *  are no longer waited for. */
  flowDeadlineMin: number;
  /** How long a failed best-effort dataset waits before it is tried again. */
  bestEffortRetryMs: number;
  /**
   * How long market status waits between attempts while only its detail is
   * missing. Each attempt costs four requests to the rate-limited TWSE host,
   * and margin (MI_MARGN) is routinely published hours after the close.
   */
  detailRetryMs: number;
}

export type DecisionAction =
  /** run it now */
  | "run"
  /** latest run is final for this session */
  | "done"
  /** not final, but nothing new to try in this run (already attempted, or cooling down) */
  | "hold"
  /** an input it reads is not ready */
  | "blocked"
  /** stopped waiting at the deadline; downstream steps finalize without it */
  | "given-up"
  /** not part of this job */
  | "out-of-scope";

export interface Decision {
  dataset: PipelineDataset;
  action: DecisionAction;
  reason: string;
  /** flows only: the attempt at or after the deadline, where "not published" becomes a failure. */
  lastCall?: boolean;
  /** scores / sentiment only: computed while flows are still pending, recorded as partial. */
  provisional?: boolean;
}

export interface Plan {
  session: string;
  /** The flow deadline on the session day. */
  deadline: Date;
  decisions: Decision[];
  /** The first runnable step, or null when there is nothing to do. */
  next: Decision | null;
  /** Every required dataset in scope has a successful latest run. */
  complete: boolean;
  /** Nothing a later poll could change: every required dataset in scope is done or given up. */
  settled: boolean;
}

const TAIPEI_OFFSET_MIN = 8 * 60;

/** The flow deadline on the session day, as an instant (Taipei has no DST). */
export function deadlineFor(session: string, deadlineMin: number): Date {
  return new Date(Date.parse(`${session}T00:00:00.000Z`) + (deadlineMin - TAIPEI_OFFSET_MIN) * 60_000);
}

/** Parses `PIPELINE_FLOW_DEADLINE` ("HH:MM", Asia/Taipei). Null when unset or malformed. */
export function parseDeadline(value: string | undefined): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatDeadline(deadlineMin: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(deadlineMin / 60))}:${pad(deadlineMin % 60)}`;
}

const WROTE: readonly DatasetStatus[] = ["success", "partial"];

export function planRun(state: PlanState, now: Date, options: PlanOptions): Plan {
  const deadline = deadlineFor(state.session, options.flowDeadlineMin);
  const pastDeadline = now.getTime() >= deadline.getTime();

  const status = (d: PipelineDataset): DatasetStatus | null => state.thisRun[d] ?? state.previous[d]?.status ?? null;
  const ran = (d: PipelineDataset) => state.thisRun[d] !== undefined;
  const wrote = (d: PipelineDataset) => WROTE.includes(state.thisRun[d] as DatasetStatus);
  const ok = (d: PipelineDataset) => status(d) === "success";
  /** The latest attempt happened at or after the deadline: there will be no other. */
  const lastCallMade = (d: PipelineDataset) =>
    pastDeadline && (ran(d) || (state.previous[d]?.at.getTime() ?? -Infinity) >= deadline.getTime());

  const flowsGivenUp = !ok("flows") && lastCallMade("flows");
  const flowsSettled = ok("flows") || flowsGivenUp;
  // Detail (breadth, market institutional net, margin) lands in the same row as
  // the index close, so `partial` still means "the session's market row exists".
  const marketRow = status("market-status") === "success" || status("market-status") === "partial";

  const make = (dataset: PipelineDataset, action: DecisionAction, reason: string, extra: Partial<Decision> = {}): Decision => ({
    dataset,
    action,
    reason,
    ...extra,
  });
  const lastText = (d: PipelineDataset) => {
    const s = status(d);
    return s ? `latest run ${s}` : "not run for this session yet";
  };

  function decide(d: PipelineDataset): Decision {
    switch (d) {
      case "market-status": {
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced");
        if (ok(d)) return make(d, "done", "stored");
        // The row exists but breadth / institutional net / margin did not:
        // re-asked on a cooldown until the deadline, once more at it, then
        // accepted as is. A missing ROW is never given up on, and retried every
        // poll — technicals and scores need the TAIEX close.
        if (status(d) === "partial") {
          if (lastCallMade(d)) return make(d, "given-up", "detail not published by the deadline");
          const prev = state.previous[d];
          if (!pastDeadline && prev && now.getTime() - prev.at.getTime() < options.detailRetryMs) {
            return make(d, "hold", "detail not published yet; retried after a cooldown");
          }
        }
        return make(d, "run", pastDeadline && status(d) === "partial" ? "last call after the deadline" : lastText(d));
      }

      case "prices": {
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced");
        if (ok(d)) return make(d, "done", "complete");
        return make(d, "run", lastText(d));
      }

      case "fundamentals":
      case "catalysts":
      case "indicators": {
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced");
        const prev = state.previous[d];
        if (!prev) return make(d, "run", "not run for this session yet");
        if (prev.status === "success" || prev.status === "partial" || prev.status === "skipped") {
          return make(d, "done", "already ran for this session");
        }
        if (now.getTime() - prev.at.getTime() < options.bestEffortRetryMs) {
          return make(d, "hold", `latest run ${prev.status}; retried after a cooldown`);
        }
        return make(d, "run", `retry after ${prev.status}`);
      }

      case "flows": {
        if (!ok("prices")) return make(d, "blocked", "waiting for complete prices");
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced", { lastCall: pastDeadline });
        if (ok(d)) return make(d, "done", "complete");
        if (flowsGivenUp) return make(d, "given-up", "not published by the deadline");
        return make(d, "run", pastDeadline ? "last call after the deadline" : lastText(d), { lastCall: pastDeadline });
      }

      case "technicals": {
        if (!ok("prices")) return make(d, "blocked", "waiting for complete prices");
        if (!marketRow) return make(d, "blocked", "waiting for the session's market status");
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced");
        if (!ok(d)) return make(d, "run", lastText(d));
        // New flow rows need their breakoutCount stamped, which only this pass does.
        if (wrote("prices") || wrote("flows")) return make(d, "run", "prices or flows written in this run");
        return make(d, "done", "up to date");
      }

      case "scores":
      case "sentiment": {
        if (!ok("prices")) return make(d, "blocked", "waiting for complete prices");
        if (!marketRow) return make(d, "blocked", "waiting for the session's market status");
        if (!ok("technicals")) return make(d, "blocked", "waiting for technicals");
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        const provisional = !flowsSettled;
        if (state.force) return make(d, "run", "forced", { provisional });
        if (ran("technicals")) return make(d, "run", "technicals recomputed in this run", { provisional });
        if (ok(d)) return make(d, "done", "final");
        // Provisional numbers are already stored and nothing they read has
        // changed since; recomputing them every poll would only burn time.
        if (status(d) === "partial" && provisional) return make(d, "hold", "provisional until flows land");
        return make(d, "run", provisional ? `${lastText(d)}; flows pending` : lastText(d), { provisional });
      }

      case "alerts":
      case "brief": {
        if (state.scope === "data") return make(d, "out-of-scope", "not part of the refresh job");
        if (!ok("scores") || !ok("sentiment")) return make(d, "blocked", "waiting for final scores and sentiment");
        if (ran(d)) return make(d, "hold", `attempted in this run (${status(d)})`);
        if (state.force) return make(d, "run", "forced");
        if (ran("scores") || ran("sentiment")) return make(d, "run", "scores recomputed in this run");
        if (!ok(d)) return make(d, "run", lastText(d));
        return make(d, "done", "final");
      }
    }
  }

  const decisions = STEP_ORDER.map(decide);
  const inScope = REQUIRED_DATASETS.filter((d) => state.scope === "all" || (d !== "alerts" && d !== "brief"));
  const byDataset = new Map(decisions.map((x) => [x.dataset, x] as const));

  return {
    session: state.session,
    deadline,
    decisions,
    next: decisions.find((x) => x.action === "run") ?? null,
    complete: inScope.every((d) => ok(d)),
    settled: inScope.every((d) => {
      const action = byDataset.get(d)?.action;
      return action === "done" || action === "given-up";
    }),
  };
}

/** The state the NEXT poll will start from: this run's outcomes become history. */
export function mergeRun(state: PlanState, at: Date): PlanState {
  const previous = { ...state.previous };
  for (const [d, s] of Object.entries(state.thisRun) as [PipelineDataset, DatasetStatus][]) {
    previous[d] = { status: s, at };
  }
  return { ...state, previous, thisRun: {}, force: false };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** The part of JobRunHandle the executor needs; the real handle satisfies it. */
export interface StepRecorder {
  dataset<T>(dataset: DatasetKey, fn: () => Promise<{ value: T; outcome?: DatasetOutcome }>): Promise<DatasetStepResult<T>>;
  record(dataset: DatasetKey, outcome: DatasetOutcome & { status: DatasetStatus; error?: unknown; durationMs?: number }): Promise<void>;
}

export type StepFn = (decision: Decision) => Promise<{ value: unknown; outcome?: DatasetOutcome }>;
export type StepTable = Partial<Record<PipelineDataset, StepFn>>;

export interface Execution {
  /** Final state, with `thisRun` holding every outcome recorded. */
  state: PlanState;
  /** The decisions that were executed, in order. */
  executed: Decision[];
  /** What each step returned, for the job summary. */
  values: Partial<Record<PipelineDataset, unknown>>;
}

/**
 * Runs the plan one step at a time, re-planning after each, so a step whose
 * input just became ready runs in the same poll and a step whose input just
 * failed does not.
 *
 * A failing step never stops the loop: `recorder.dataset` records the error
 * and returns, the planner sees the dataset as attempted-and-not-successful,
 * and every step that does not read it carries on. Each dataset runs at most
 * once per run, so the loop is bounded by the number of datasets.
 */
export async function executePlan(
  recorder: StepRecorder,
  initial: PlanState,
  now: Date,
  options: PlanOptions,
  steps: StepTable,
): Promise<Execution> {
  const state: PlanState = { ...initial, thisRun: { ...initial.thisRun } };
  const executed: Decision[] = [];
  const values: Partial<Record<PipelineDataset, unknown>> = {};

  for (let guard = 0; guard <= STEP_ORDER.length; guard++) {
    const next = planRun(state, now, options).next;
    if (!next) break;
    executed.push(next);

    const fn = steps[next.dataset];
    if (!fn) {
      await recorder.record(next.dataset, { status: "skipped", note: "no step registered for this job" });
      state.thisRun[next.dataset] = "skipped";
      continue;
    }
    const result = await recorder.dataset(next.dataset, () => fn(next));
    state.thisRun[next.dataset] = result.status;
    if (result.value !== undefined) values[next.dataset] = result.value;
  }

  return { state, executed, values };
}
