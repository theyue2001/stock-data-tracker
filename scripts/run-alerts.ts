import { runAlertEngine } from "../src/lib/jobs/generate-alerts";
import { revalidateDeployedCache } from "./_revalidate";
import { db } from "../src/lib/db";

runAlertEngine()
  .then(async (n) => {
    console.log(`[alerts] created ${n} new alert(s)`);
    await revalidateDeployedCache("alerts");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
