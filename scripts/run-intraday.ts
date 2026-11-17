import { runIntradayRefreshJob } from "../src/lib/jobs/refresh-intraday";
import { revalidateDeployedCache } from "./_revalidate";
import { db } from "../src/lib/db";

runIntradayRefreshJob({ trigger: "cli" })
  .then(async (s) => {
    console.log("[intraday]", s);
    // A skip or a "no trade yet" wrote nothing, so there is nothing to expire.
    if (s.ticks > 0) await revalidateDeployedCache("intraday", "intraday");
    if (s.status === "failed") process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
