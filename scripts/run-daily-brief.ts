import { runDailyBriefJob } from "../src/lib/jobs/generate-daily-brief";
import { revalidateDeployedCache } from "./_revalidate";
import { db } from "../src/lib/db";

runDailyBriefJob()
  .then(async (b) => {
    console.log(`[brief] generated brief for ${b.date.toISOString().slice(0, 10)} via ${b.generatedBy}`);
    await revalidateDeployedCache("brief");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
