import { withJobLock, type LockResult } from "./job-lock";

/**
 * One lease shared by every job that writes the session tables — the daily
 * and refresh routes, the alerts and brief jobs, the CLI scripts, the backfill
 * and the indicator import. They are not independent: institutional_flows and
 * catalysts have no unique key the database can enforce (see writeFlowRow and
 * writeCatalysts in persist.ts), so two overlapping writers can both miss an
 * existing row and both insert it. Serializing the writers is what closes that.
 */
export const PIPELINE_LOCK = "pipeline";

/** Route handlers run for at most `maxDuration` = 300 s; a minute of margin on top. */
export const PIPELINE_LOCK_TTL_MS = 6 * 60_000;

export interface PipelineLockOptions {
  /** Lease length. A holder that dies loses the lock at most this long after its last heartbeat. */
  ttlMs?: number;
  /**
   * Stop renewing after this long, so a hung process cannot hold the pipeline
   * hostage forever. Defaults to the TTL — i.e. no renewal — which is right for
   * a route handler: the platform kills it before the lease lapses.
   */
  maxHoldMs?: number;
}

/**
 * CLI runs have no platform time limit, so the lease is renewed while they
 * work — up to half an hour, after which a hung process lets it lapse.
 */
export const CLI_LOCK: PipelineLockOptions = { ttlMs: PIPELINE_LOCK_TTL_MS, maxHoldMs: 30 * 60_000 };

/**
 * `withJobLock("pipeline", …)` plus a heartbeat that renews the lease while
 * `fn` runs (up to `maxHoldMs`), for jobs that may outlive one TTL.
 */
export async function withPipelineLock<T>(fn: () => Promise<T>, opts: PipelineLockOptions = {}): Promise<LockResult<T>> {
  const ttlMs = opts.ttlMs ?? PIPELINE_LOCK_TTL_MS;
  const maxHoldMs = opts.maxHoldMs ?? ttlMs;

  return withJobLock(PIPELINE_LOCK, ttlMs, async (lease) => {
    const startedAt = Date.now();
    const timer =
      maxHoldMs > ttlMs
        ? setInterval(() => {
            if (Date.now() - startedAt + ttlMs > maxHoldMs) return;
            lease.extend(ttlMs).then(
              (held) => {
                if (!held) console.error(`[job-lock] lost the ${PIPELINE_LOCK} lease (holder ${lease.holder})`);
              },
              (err: unknown) => console.error(`[job-lock] renewing ${PIPELINE_LOCK} failed:`, err instanceof Error ? err.message : err),
            );
          }, Math.max(15_000, Math.floor(ttlMs / 3)))
        : null;
    // A heartbeat must never be what keeps a finished CLI process alive.
    timer?.unref?.();
    try {
      return await fn();
    } finally {
      if (timer) clearInterval(timer);
    }
  });
}

/** JobRun.reason for a run that found the lock taken. */
export function alreadyRunningReason(result: { heldBy: string | null; expiresAt: Date | null }): string {
  return `already running (holder ${result.heldBy ?? "unknown"}, until ${result.expiresAt?.toISOString() ?? "unknown"})`;
}
