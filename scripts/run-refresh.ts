/**
 * The data half of the pipeline (no alerts, no brief) for the newest published
 * session. Runs only what the session still lacks; `--force` re-runs every
 * dataset once, e.g. to pick up flows that were published after the deadline.
 *
 *   npm run jobs:refresh
 *   npm run jobs:refresh -- --force
 */
import { runDailyPipeline } from "../src/lib/jobs/pipeline";
import { CLI_LOCK } from "../src/lib/jobs/pipeline-lock";
import { reportCliJob } from "./_revalidate";
import { db } from "../src/lib/db";

runDailyPipeline({ trigger: "cli", job: "refresh", force: process.argv.includes("--force"), lock: CLI_LOCK })
  .then((result) => reportCliJob("refresh", result))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
