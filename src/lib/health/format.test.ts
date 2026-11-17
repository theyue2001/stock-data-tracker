import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAge, formatDuration, taipeiTime, urlHost } from "./format";

test("taipeiTime renders Taipei wall time regardless of the server timezone", () => {
  const d = new Date("2026-11-17T08:05:12Z");
  assert.equal(taipeiTime(d), "11/17 16:05");
  assert.equal(taipeiTime(d, { full: true }), "2026-11-17 16:05:12");
  assert.equal(taipeiTime(new Date("2026-11-16T16:30:00Z")), "11/17 00:30");
  assert.equal(taipeiTime(null), "—");
});

test("formatAge and formatDuration pick a readable unit", () => {
  assert.equal(formatAge(45), "45 秒");
  assert.equal(formatAge(600), "10 分鐘");
  assert.equal(formatAge(3 * 3600 + 1800), "3.5 小時");
  assert.equal(formatAge(3 * 86400), "3 天");
  assert.equal(formatAge(null), "—");
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(2340), "2.3 秒");
  assert.equal(formatDuration(245000), "4 分 05 秒");
});

test("urlHost", () => {
  assert.equal(urlHost("https://openapi.twse.com.tw/v1/x"), "openapi.twse.com.tw");
  assert.equal(urlHost("not a url"), "not a url");
});
