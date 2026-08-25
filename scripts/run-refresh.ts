import { runRefreshJob } from "../src/lib/jobs/refresh-data";
import { revalidateDeployedCache } from "./_revalidate";
import { db } from "../src/lib/db";

runRefreshJob()
  .then(async (s) => {
    console.log("[refresh]", s);
    await revalidateDeployedCache("refresh");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
