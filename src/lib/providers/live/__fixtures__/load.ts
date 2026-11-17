import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads a saved exchange response from __fixtures__ for the parser tests.
 * Each file is a real response trimmed to a handful of rows; the file name
 * carries the session it was captured for.
 */
export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, name), "utf8")) as T;
}
