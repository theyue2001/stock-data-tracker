import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { db } from "@/lib/db";

/**
 * Lease lock over the `job_locks` table, so overlapping invocations of the same
 * job never write the same session at once (Vercel cron, an external
 * scheduler and a CLI run can all fire within the same minute).
 *
 * Why a lease and not `pg_advisory_lock`: DATABASE_URL goes through PgBouncer
 * in transaction mode, so consecutive statements can land on different server
 * connections and a session-level advisory lock may never be released by the
 * connection that took it. A row with an expiry needs no session affinity, and
 * a holder that dies (function timeout, killed process) simply lets the lease
 * lapse.
 *
 * All times are the database's clock (`NOW() AT TIME ZONE 'UTC'`, matching how
 * Prisma stores `DateTime` in a `timestamp(3)` column) so a skewed function
 * clock cannot steal a live lease.
 */

export interface LockLease {
  readonly name: string;
  readonly holder: string;
  /** Push the expiry out again, for steps that may outlive the first TTL. Returns false if the lease was lost. */
  extend(ttlMs: number): Promise<boolean>;
  release(): Promise<void>;
}

export type LockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; heldBy: string | null; expiresAt: Date | null };

function newHolder(): string {
  const where = process.env.VERCEL_REGION ?? hostname();
  return `${where}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/** Take the lease if it is free or expired; null when someone else holds it. */
export async function tryAcquireLock(name: string, ttlMs: number): Promise<LockLease | null> {
  const holder = newHolder();
  const ttl = Math.max(1000, Math.round(ttlMs));
  const rows = await db.$queryRaw<{ holder: string }[]>`
    INSERT INTO "job_locks" ("name", "holder", "expiresAt", "updatedAt")
    VALUES (${name}, ${holder}, (NOW() AT TIME ZONE 'UTC') + (${ttl}::int * INTERVAL '1 millisecond'), (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "job_locks"."expiresAt" < (NOW() AT TIME ZONE 'UTC')
    RETURNING "holder"`;
  if (rows[0]?.holder !== holder) return null;

  return {
    name,
    holder,
    async extend(ms) {
      const n = await db.$executeRaw`
        UPDATE "job_locks"
        SET "expiresAt" = (NOW() AT TIME ZONE 'UTC') + (${Math.max(1000, Math.round(ms))}::int * INTERVAL '1 millisecond'),
            "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        WHERE "name" = ${name} AND "holder" = ${holder}`;
      return n === 1;
    },
    async release() {
      try {
        await db.$executeRaw`DELETE FROM "job_locks" WHERE "name" = ${name} AND "holder" = ${holder}`;
      } catch (err) {
        // The lease expires on its own; a failed release only delays the next run.
        console.error(`[job-lock] release ${name} failed:`, err instanceof Error ? err.message : err);
      }
    },
  };
}

/** Who holds a lock right now, for the "skipped: already running" log line. */
export async function lockHolder(name: string): Promise<{ holder: string; expiresAt: Date } | null> {
  const row = await db.jobLock.findUnique({ where: { name }, select: { holder: true, expiresAt: true } });
  return row && row.expiresAt.getTime() > Date.now() ? row : null;
}

/** Run `fn` while holding the lease; skip (without running it) when another holder has it. */
export async function withJobLock<T>(name: string, ttlMs: number, fn: (lease: LockLease) => Promise<T>): Promise<LockResult<T>> {
  const lease = await tryAcquireLock(name, ttlMs);
  if (!lease) {
    const held = await lockHolder(name).catch(() => null);
    return { acquired: false, heldBy: held?.holder ?? null, expiresAt: held?.expiresAt ?? null };
  }
  try {
    return { acquired: true, value: await fn(lease) };
  } finally {
    await lease.release();
  }
}
