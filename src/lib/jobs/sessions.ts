import { db } from "@/lib/db";
import { utcDay } from "@/lib/dates";
import { SESSION_CLOSE_MIN } from "@/lib/market-session";

/**
 * Session keys shared by the pipeline steps and the alert / brief jobs.
 * Everything a job writes is keyed by the market SESSION it describes, never
 * by the day the job happened to run: a rerun the next morning, or a late
 * safety-net run after midnight UTC, must land on the same rows.
 */

/**
 * The session's close, 13:30 Asia/Taipei, as an instant. It is the as-of time
 * of everything published for the session, and the deterministic timestamp
 * an alert about the session carries (see runAlertEngine).
 */
export function sessionCloseAt(session: Date): Date {
  return new Date(utcDay(session).getTime() + (SESSION_CLOSE_MIN - 8 * 60) * 60_000);
}

/**
 * The newest session already stored. Mock mode has no live feed to ask what
 * has been published, so this IS its target session; live mode falls back to
 * it when the published-session probe is unreachable.
 */
export async function latestStoredSession(): Promise<Date | null> {
  const [status, quote] = await Promise.all([
    db.marketStatus.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    db.marketData.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const dates = [status?.date, quote?.date].filter((d): d is Date => !!d);
  if (!dates.length) return null;
  return utcDay(dates.reduce((a, d) => (d > a ? d : a)));
}

/** The newest session with industry scores — what a standalone alerts or brief run describes. */
export async function latestScoredSession(): Promise<Date | null> {
  const score = await db.industryScore.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  return score ? utcDay(score.date) : latestStoredSession();
}
