import assert from "node:assert/strict";
import test from "node:test";
import { matchesPath, matchesRequest } from "../../src/matcher.js";

test("matches exact and globbed paths", () => {
  assert.equal(matchesPath("/checkout", "/checkout"), true);
  assert.equal(matchesPath("/checkout/confirm", "/checkout/**"), true);
  assert.equal(matchesPath("/account", ["/checkout", "/account"]), true);
  assert.equal(matchesPath("/accounts", "/account"), false);
});

test("matches methods case-insensitively", () => {
  const rule = { match: "/api/**", methods: ["POST"] };
  assert.equal(matchesRequest(rule, "/api/order", "post"), true);
  assert.equal(matchesRequest(rule, "/api/order", "GET"), false);
});
