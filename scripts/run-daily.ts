/**
 * The after-hours pipeline for the newest published session, from the command
 * line — the same runDailyPipeline the /api/jobs/daily route and the
 * long-running scheduler call, with the same planning, lock and job log. Runs
 * only what the session still lacks; `--force` re-runs every dataset once.
 *
 *   npm run jobs:daily
 *   npm run jobs:daily -- --force
 */
import { runDailyPipeline } from "../src/lib/jobs/pipeline";
import { CLI_LOCK } from "../src/lib/jobs/pipeline-lock";
import { reportCliJob } from "./_revalidate";
import { db } from "../src/lib/db";

async function main() {
  const result = await runDailyPipeline({ trigger: "cli", force: process.argv.includes("--force"), lock: CLI_LOCK });
  await reportCliJob("daily", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
