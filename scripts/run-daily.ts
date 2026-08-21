/**
 * The full daily pipeline, in order: refresh data from providers, recompute
 * scores, evaluate alert rules, then generate the AI daily brief.
 * This is what the 20:00 Taiwan-time cron entry point calls.
 */
import { runRefreshJob } from "../src/lib/jobs/refresh-data";
import { runAlertEngine } from "../src/lib/jobs/generate-alerts";
import { runDailyBriefJob } from "../src/lib/jobs/generate-daily-brief";
import { db } from "../src/lib/db";

async function main() {
  const refresh = await runRefreshJob();
  console.log("[daily] refresh:", refresh);

  const alerts = await runAlertEngine();
  console.log(`[daily] alerts: ${alerts} new`);

  const brief = await runDailyBriefJob();
  console.log(`[daily] brief: ${brief.date.toISOString().slice(0, 10)} via ${brief.generatedBy}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
