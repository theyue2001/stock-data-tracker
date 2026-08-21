import { runRefreshJob } from "../src/lib/jobs/refresh-data";
import { db } from "../src/lib/db";

runRefreshJob()
  .then((s) => console.log("[refresh]", s))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
