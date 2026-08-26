import { runIntradayRefreshJob } from "../src/lib/jobs/refresh-intraday";
import { revalidateDeployedCache } from "./_revalidate";
import { db } from "../src/lib/db";

runIntradayRefreshJob()
  .then(async (s) => {
    console.log("[intraday]", s);
    await revalidateDeployedCache("intraday", "intraday");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
