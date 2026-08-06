import assert from "node:assert/strict";
import test from "node:test";
import { parseCookieHeader, rewriteSetCookie } from "../../src/cookies.js";

test("parses cookie values without truncating embedded equals signs", () => {
  assert.deepEqual(parseCookieHeader("session=a=b=c; mode=test"), {
    session: "a=b=c",
    mode: "test",
  });
});

test("isolates an upstream cookie on an HTTP staging origin", () => {
  const result = rewriteSetCookie(
    "session=abc; Domain=production.test; Path=/; Secure; HttpOnly; SameSite=Lax",
    {
      mode: "isolate",
      sharedNames: [],
      stripSecureOnHttp: true,
    },
    false,
  );
  assert.equal(result, "session=abc; Path=/; HttpOnly; SameSite=Lax");
});

test("never domain-shares a __Host- cookie", () => {
  const result = rewriteSetCookie(
    "__Host-session=abc; Path=/; Secure",
    {
      mode: "shared-parent",
      sharedDomain: ".example.com",
      sharedNames: ["__Host-session"],
      stripSecureOnHttp: false,
    },
    true,
  );
  assert.equal(result, "__Host-session=abc; Path=/; Secure");
});
