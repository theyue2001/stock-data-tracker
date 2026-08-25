/**
 * Read-only smoke test for every live provider.
 *
 * A thin CLI over the same check suite `/api/jobs/verify` runs, so a local run
 * and a scheduled run can never disagree about what "the feeds are healthy"
 * means. Writes nothing.
 *
 *   npm run verify:sources
 */
import { db } from "../src/lib/db";
import { runSourceVerification } from "../src/lib/jobs/verify-sources";

async function main() {
  const { checks, passed, failed } = await runSourceVerification();

  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(20)} ${c.detail}`);
  }
  console.log(`\n${passed}/${checks.length} checks passed`);

  if (failed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
