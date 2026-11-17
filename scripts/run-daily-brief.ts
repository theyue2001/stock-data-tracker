import { runBriefJob } from "../src/lib/jobs/pipeline";
import { CLI_LOCK } from "../src/lib/jobs/pipeline-lock";
import { reportCliJob } from "./_revalidate";
import { db } from "../src/lib/db";

runBriefJob({ trigger: "cli", lock: CLI_LOCK })
  .then((result) => reportCliJob("brief", result))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
