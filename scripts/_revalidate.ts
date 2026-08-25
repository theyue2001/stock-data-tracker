/**
 * Tells a deployed instance to drop its cached read layer after a CLI job has
 * written new data.
 *
 * Why this exists: every screen reads through `"use cache"` functions with a
 * `days` lifetime (src/lib/queries.ts), so a job that writes to Postgres from
 * the command line changes nothing the dashboard shows — the running instance
 * keeps serving its prerendered pages for up to a day, and up to a week if
 * traffic is low enough that no background revalidate is triggered. The job
 * routes under src/app/api/jobs/ call `revalidateTag` inline; a script cannot,
 * because `revalidateTag` needs a request context and the deployed instance is
 * a different process entirely. So the script asks it over HTTP.
 *
 * Best-effort by design: the database write has already succeeded by the time
 * this runs, so a failure here is a staleness problem, not a job failure, and
 * must never turn a successful pipeline into a non-zero exit.
 */

const ROUTE = "/api/jobs/revalidate";

export async function revalidateDeployedCache(label = "job"): Promise<void> {
  const appUrl = process.env.APP_URL?.trim();

  if (!appUrl) {
    // Not an error: this is the normal case for local development, where there
    // is no deployed instance to tell. Said out loud so it is never a silent
    // no-op on a machine that DOES drive a deployment.
    console.warn(
      `[${label}] APP_URL is not set — the deployed read cache was NOT invalidated. ` +
        `Set APP_URL, or POST ${ROUTE} manually, or the dashboard may show pre-job data for up to a day.`,
    );
    return;
  }

  const secret = process.env.CRON_SECRET?.trim();
  const url = `${appUrl.replace(/\/$/, "")}${ROUTE}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    if (!response.ok) {
      console.error(
        `[${label}] cache revalidation failed: HTTP ${response.status} from ${url}. ` +
          `Data was written, but the dashboard may serve stale pages.`,
      );
      return;
    }
    console.log(`[${label}] deployed read cache invalidated`);
  } catch (error) {
    console.error(
      `[${label}] cache revalidation could not reach ${url}: ${(error as Error).message}. ` +
        `Data was written, but the dashboard may serve stale pages.`,
    );
  }
}
