import { runAlertEngine } from "../src/lib/jobs/generate-alerts";
import { db } from "../src/lib/db";

runAlertEngine()
  .then((n) => console.log(`[alerts] created ${n} new alert(s)`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
