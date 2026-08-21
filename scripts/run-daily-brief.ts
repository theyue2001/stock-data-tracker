import { runDailyBriefJob } from "../src/lib/jobs/generate-daily-brief";
import { db } from "../src/lib/db";

runDailyBriefJob()
  .then((b) => console.log(`[brief] generated brief for ${b.date.toISOString().slice(0, 10)} via ${b.generatedBy}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
