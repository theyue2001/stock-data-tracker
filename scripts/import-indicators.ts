/**
 * Imports real values for leading indicators that have no free public feed.
 *
 * Most of the indicator taxonomy is licensed data — SCFI from the Shanghai
 * Shipping Exchange, DRAM/NAND contract pricing and panel pricing from
 * TrendForce, wafer shipment area and WFE billings from SEMI, MLCC
 * book-to-bill from the component distributors. There is no lawful free
 * endpoint for any of them, and substituting a "close enough" proxy would
 * quietly change what the indicator measures while the UI kept the original
 * label and unit. So they are imported instead, from whatever the operator
 * actually has access to.
 *
 * Rows land with isMock=false and a real sourceUrl, so they are
 * indistinguishable from feed-sourced values downstream — which is correct,
 * because they are equally real.
 *
 *   npm run import:indicators -- data/indicators.csv
 *
 * CSV format (header required):
 *   indicator_key,date,value,source_url
 *   scfi,2026-08-22,1842.5,https://en.sse.net.cn/indices/scfinew.jsp
 *   dram_contract_price,2026-08-01,2.15,https://www.trendforce.com/
 *
 * `date` is the date the value was PUBLISHED or effective (ISO YYYY-MM-DD),
 * not the period it describes — the scoring pass treats stored dates as
 * "knowable as of", and dating a monthly figure to the start of its own month
 * is what turns a backtest into a lookahead.
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { ensureDataSource, writeIndicatorValues } from "../src/lib/jobs/persist";
import type { IndicatorResult } from "../src/lib/providers/types";

const MANUAL_SOURCE = {
  key: "manual-indicator-import",
  name: "Operator-imported Indicator Values",
  category: "indicator" as const,
  isMock: false,
  description:
    "Licensed or manually-read indicator values loaded from CSV (SCFI, TrendForce pricing, SEMI billings, and similar series with no free feed).",
};

interface ParsedRow extends IndicatorResult {
  line: number;
}

function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith("#"));
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  if (!lines.length) return { rows, errors: ["file is empty"] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const keyIdx = col("indicator_key");
  const dateIdx = col("date");
  const valueIdx = col("value");
  const urlIdx = col("source_url");

  if (keyIdx < 0 || dateIdx < 0 || valueIdx < 0) {
    return { rows, errors: ["header must contain indicator_key, date and value"] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const line = i + 1;
    const key = (cells[keyIdx] ?? "").trim();
    const dateText = (cells[dateIdx] ?? "").trim();
    const valueText = (cells[valueIdx] ?? "").trim().replace(/,/g, "");

    if (!key) {
      errors.push(`line ${line}: missing indicator_key`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      errors.push(`line ${line}: date must be YYYY-MM-DD, got "${dateText}"`);
      continue;
    }
    const value = Number(valueText);
    if (!Number.isFinite(value)) {
      errors.push(`line ${line}: value is not a number, got "${valueText}"`);
      continue;
    }

    rows.push({
      line,
      indicatorKey: key,
      date: new Date(`${dateText}T00:00:00.000Z`),
      value,
      sourceUrl: (cells[urlIdx] ?? "").trim() || undefined,
    });
  }

  return { rows, errors };
}

/** Minimal RFC-4180 split: enough for quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run import:indicators -- <file.csv>");
    process.exit(1);
  }

  const { rows, errors } = parseCsv(readFileSync(path, "utf-8"));
  for (const error of errors) console.error(`[import] ${error}`);
  if (!rows.length) {
    console.error("[import] nothing to import");
    process.exit(1);
  }

  // Reject unknown keys before writing anything. A typo would otherwise be
  // silently skipped by the writer and read as "the file had fewer rows".
  const known = new Set((await db.indicator.findMany({ select: { key: true } })).map((i) => i.key));
  const unknown = [...new Set(rows.filter((r) => !known.has(r.indicatorKey)).map((r) => r.indicatorKey))];
  if (unknown.length) {
    console.error(`[import] unknown indicator keys: ${unknown.join(", ")}`);
    console.error("[import] known keys:", [...known].sort().join(", "));
    process.exit(1);
  }

  const sourceId = await ensureDataSource(MANUAL_SOURCE);
  const written = await writeIndicatorValues(rows, sourceId, false);
  console.log(`[import] wrote ${written} values across ${new Set(rows.map((r) => r.indicatorKey)).size} indicators`);
  console.log("[import] run `npm run jobs:refresh` to fold them into today's scores");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
