import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpStatusError, httpStatusOf } from "@/lib/providers/errors";
import {
  BlockedError,
  HttpError,
  RETRY_AFTER_CAP_MS,
  RETRY_CAP_MS,
  backoffDelay,
  parseRetryAfter,
  retryDelay,
} from "./http";

const NOW = Date.parse("2026-11-17T08:00:00Z");
const URL_ = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";

test("backoffDelay is full jitter under an exponential, capped ceiling", () => {
  // random() -> just under 1 gives the ceiling, 0 gives 0
  const top = () => 0.999999;
  assert.equal(backoffDelay(0, { random: () => 0 }), 0);
  assert.equal(backoffDelay(0, { random: top }), 1499);
  assert.equal(backoffDelay(1, { random: top }), 2999);
  assert.equal(backoffDelay(2, { random: top }), 5999);
  assert.equal(backoffDelay(10, { random: top }), RETRY_CAP_MS - 1);
  assert.equal(backoffDelay(1, { random: () => 0.5 }), 1500);
});

test("backoffDelay never undercuts the host's own spacing", () => {
  assert.equal(backoffDelay(0, { random: () => 0, floorMs: 4000 }), 4000);
  assert.equal(backoffDelay(3, { random: () => 0.9, floorMs: 4000 }), 10800);
});

test("parseRetryAfter reads delay-seconds", () => {
  assert.equal(parseRetryAfter("120", NOW), 120_000);
  assert.equal(parseRetryAfter(" 0 ", NOW), 0);
});

test("parseRetryAfter reads an HTTP-date relative to now, past dates as 0", () => {
  assert.equal(parseRetryAfter("Tue, 17 Nov 2026 08:00:30 GMT", NOW), 30_000);
  assert.equal(parseRetryAfter("Tue, 17 Nov 2026 07:59:00 GMT", NOW), 0);
  // RFC 850 and asctime forms are still HTTP-dates
  assert.equal(parseRetryAfter("Tuesday, 17-Nov-26 08:01:00 GMT", NOW), 60_000);
});

test("parseRetryAfter refuses anything that is not a valid hint", () => {
  for (const v of [null, undefined, "", "soon", "-5", "1.5", "Mon, 99 Foo 2026 xx GMT"]) {
    assert.equal(parseRetryAfter(v, NOW), null, String(v));
  }
});

test("HttpError and BlockedError are HttpStatusErrors, so the job log sees their status", () => {
  const e = new HttpError(503, URL_, 5000);
  assert.ok(e instanceof HttpStatusError);
  assert.equal(httpStatusOf(e), 503);
  assert.match(e.message, /HTTP 503 .*Retry-After 5 s/);
  const b = new BlockedError(URL_);
  assert.ok(b instanceof HttpStatusError);
  assert.equal(httpStatusOf(b), 307);
  assert.equal(b.name, "BlockedError");
});

test("retryDelay does not retry 4xx or a block page", () => {
  assert.equal(retryDelay(new HttpError(404, URL_), 0), null);
  assert.equal(retryDelay(new HttpError(403, URL_), 0), null);
  assert.equal(retryDelay(new BlockedError(URL_), 0), null);
});

test("retryDelay honours Retry-After on 429/503, floored at the host spacing", () => {
  assert.equal(retryDelay(new HttpError(429, URL_, 7000), 0, { floorMs: 4000 }), 7000);
  assert.equal(retryDelay(new HttpError(503, URL_, 0), 2, { floorMs: 4000 }), 4000);
});

test("retryDelay gives up when Retry-After asks for longer than the cap", () => {
  assert.equal(retryDelay(new HttpError(429, URL_, RETRY_AFTER_CAP_MS + 1), 0), null);
  assert.equal(retryDelay(new HttpError(429, URL_, RETRY_AFTER_CAP_MS), 0), RETRY_AFTER_CAP_MS);
});

test("retryDelay backs off on 5xx without a hint, 408, 429 without a hint, and network errors", () => {
  const opts = { random: () => 0.5, floorMs: 0 };
  assert.equal(retryDelay(new HttpError(500, URL_), 1, opts), 1500);
  // Retry-After is only honoured on 429/503
  assert.equal(retryDelay(new HttpError(502, URL_, 50_000), 1, opts), 1500);
  assert.equal(retryDelay(new HttpError(408, URL_), 0, opts), 750);
  assert.equal(retryDelay(new HttpError(429, URL_), 0, opts), 750);
  assert.equal(retryDelay(new TypeError("fetch failed"), 2, opts), 3000);
});
