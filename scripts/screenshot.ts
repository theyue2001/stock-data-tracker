/**
 * Captures full-page screenshots of every route against a running dev server.
 *
 * Exists because "the pages return 200" and "the pages show the right numbers"
 * are different claims, and only the second one matters after a data migration.
 *
 *   npm run dev                 # in one terminal
 *   npm run screenshots         # in another
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "screenshots";

const ROUTES = [
  ["home", "/"],
  ["momentum", "/momentum"],
  ["industries", "/industries"],
  ["industry-ai-server", "/industries/ai-server"],
  ["capital-flow", "/capital-flow"],
  ["stocks", "/stocks"],
  ["indicators", "/indicators"],
  ["daily-brief", "/daily-brief"],
  ["watchlist", "/watchlist"],
] as const;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  // Desktop-first, matching what the UI is designed for.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  const problems: string[] = [];
  // Console errors are the failure mode a 200 hides: a page can render its
  // shell fine while a client component throws on the data underneath.
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text().slice(0, 160)}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message.slice(0, 160)}`));

  for (const [name, route] of ROUTES) {
    const before = problems.length;
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const status = response?.status() ?? 0;
    const newProblems = problems.slice(before);
    console.log(
      `${status === 200 && !newProblems.length ? "OK  " : "WARN"} ${name.padEnd(20)} ${status} ${
        newProblems.length ? `— ${newProblems.length} console error(s)` : ""
      }`,
    );
    for (const p of newProblems) console.log(`       ${p}`);
  }

  await browser.close();
  console.log(`\nWrote ${ROUTES.length} screenshots to ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
