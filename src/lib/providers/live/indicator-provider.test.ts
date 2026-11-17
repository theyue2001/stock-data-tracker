import { test } from "node:test";
import assert from "node:assert/strict";
import { secHeaders } from "./indicator-provider";

test("secHeaders sends the operator's SEC_USER_AGENT, trimmed", () => {
  assert.deepEqual(secHeaders({ SEC_USER_AGENT: "  stock-data-tracker (contact: ops@example.com)  " }), {
    "User-Agent": "stock-data-tracker (contact: ops@example.com)",
  });
});

test("secHeaders is null when SEC_USER_AGENT is unset or blank, so no anonymous request is made", () => {
  assert.equal(secHeaders({}), null);
  assert.equal(secHeaders({ SEC_USER_AGENT: "" }), null);
  assert.equal(secHeaders({ SEC_USER_AGENT: "   " }), null);
});
