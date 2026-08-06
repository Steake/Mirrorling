import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProductionFixture } from "../../fixtures/production.js";
import { resolveBenchConfig } from "../../src/config.js";
import {
  createFetchBenchHandler,
  createNetlifyConfigLoader,
} from "../../src/fetch-handler.js";

test("the Fetch runtime preserves the overlay, mock, script and handoff contract", async (context) => {
  const fixture = createProductionFixture(0);
  await fixture.listen();
  context.after(async () => fixture.close());

  const config = resolveBenchConfig({
    server: { publicOrigin: "https://stage.invalid" },
    upstream: { origin: fixture.origin },
    security: { stripCsp: true, disableServiceWorkers: true },
    scenarios: [{
      id: "baseline",
      title: "Production mirror",
      default: true,
    }, {
      id: "variant",
      title: "Variant",
      elementOverrides: [{
        match: "/checkout",
        operations: [{
          id: "offer",
          type: "inner",
          selector: "#production-offer",
          html: "<h2>Fetch overlay</h2>",
          expect: { count: 1 },
        }],
      }],
      injectedScripts: [{
        id: "extra-flow",
        match: "/checkout",
        timing: "body-end",
        content: "window.fetchOverlay = true;",
      }],
      scriptOverrides: [{
        id: "production-bundle",
        match: "/assets/prod.js",
        strategy: "replace",
        content: "window.replacedProductionBundle = true;",
      }],
      routeOverrides: [{
        match: "/api/recommendation",
        methods: ["GET"],
        status: 200,
        headers: { "x-test-source": "fetch" },
        json: { source: "netlify" },
        delayMs: 0,
      }],
      handoffs: [{
        id: "finish",
        match: "/flow/complete",
        destination: "/account",
        preservePath: false,
        preserveQuery: false,
        carryQuery: ["plan"],
        status: 302,
        clientState: { transport: "none", parameter: "bench_state", stateKeys: [] },
      }],
    }],
  }, process.cwd());
  const handle = createFetchBenchHandler({ config, runtime: "netlify", environment: {} });
  const scenarioHeaders = { "x-bench-scenario": "variant" };

  const page = await handle(new Request("https://stage.invalid/checkout", {
    headers: scenarioHeaders,
  }));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-overlay-bench-runtime"), "netlify");
  assert.equal(page.headers.get("content-security-policy"), null);
  assert.equal(page.headers.get("content-encoding"), null);
  const html = await page.text();
  assert.match(html, /Fetch overlay/);
  assert.match(html, /data-overlay-bench-injected="extra-flow"/);
  assert.match(html, /data-overlay-bench-script-override="production-bundle"/);
  assert.doesNotMatch(html, /data-overlay-bench-dev-client/);
  assert.match(html, /src="https:\/\/stage\.invalid\/assets\/prod\.js"/);

  const script = await handle(new Request("https://stage.invalid/assets/prod.js", {
    headers: scenarioHeaders,
  }));
  const scriptBody = await script.text();
  assert.match(scriptBody, /replacedProductionBundle/);
  assert.doesNotMatch(scriptBody, /productionScript/);

  const mocked = await handle(new Request("https://stage.invalid/api/recommendation", {
    headers: scenarioHeaders,
  }));
  assert.deepEqual(await mocked.json(), { source: "netlify" });
  assert.equal(mocked.headers.get("x-test-source"), "fetch");

  const inspection = await handle(new Request("https://stage.invalid/api/request-inspection", {
    headers: {
      ...scenarioHeaders,
      cookie: "__overlay_bench_scenario=variant; customer=abc",
    },
  }));
  const inspected = await inspection.json() as { headers: Record<string, string | undefined> };
  assert.equal(inspected.headers["x-bench-scenario"], undefined);
  assert.equal(inspected.headers.cookie, "customer=abc");

  const handoff = await handle(new Request("https://stage.invalid/flow/complete?plan=pro&plan=team&drop=yes", {
    headers: scenarioHeaders,
  }));
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.get("location"), `${fixture.origin}/account?plan=pro&plan=team`);

  const redirect = await handle(new Request("https://stage.invalid/redirect-me", {
    headers: scenarioHeaders,
  }));
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://stage.invalid/account");
});

test("the Fetch runtime selects scenarios cleanly and exposes immutable-runtime health", async () => {
  const config = resolveBenchConfig({
    server: { publicOrigin: "https://stage.invalid" },
    upstream: { origin: "https://prod.invalid" },
    scenarios: [
      { id: "baseline", title: "Baseline", default: true },
      { id: "variant", title: "Variant" },
    ],
  }, process.cwd());
  const handle = createFetchBenchHandler({ config, runtime: "netlify", environment: {} });

  const selection = await handle(new Request("https://stage.invalid/checkout?x=1&__bench_scenario=variant"));
  assert.equal(selection.status, 302);
  assert.equal(selection.headers.get("location"), "/checkout?x=1");
  assert.match(selection.headers.get("set-cookie") ?? "", /HttpOnly/);
  assert.match(selection.headers.get("set-cookie") ?? "", /Secure/);

  const health = await handle(new Request("https://stage.invalid/__bench/health", {
    headers: { cookie: "__overlay_bench_scenario=variant" },
  }));
  assert.deepEqual(await health.json(), {
    ok: true,
    runtime: "netlify",
    scenario: "variant",
    upstream: "https://prod.invalid",
    authoring: false,
    websocketProxy: false,
  });

  const websocket = await handle(new Request("https://stage.invalid/socket", {
    headers: { upgrade: "websocket" },
  }));
  assert.equal(websocket.status, 501);
});

test("Fetch runtime Basic Auth stays at staging and is stripped before production", async (context) => {
  const fixture = createProductionFixture(0);
  await fixture.listen();
  context.after(async () => fixture.close());
  const config = resolveBenchConfig({
    server: {
      publicOrigin: "https://stage.invalid",
      access: { enabled: true, usernameEnv: "TEST_USER", passwordEnv: "TEST_PASSWORD" },
    },
    upstream: { origin: fixture.origin },
  }, process.cwd());
  const handle = createFetchBenchHandler({
    config,
    runtime: "netlify",
    environment: { TEST_USER: "bench", TEST_PASSWORD: "secret" },
  });

  const denied = await handle(new Request("https://stage.invalid/api/request-inspection"));
  assert.equal(denied.status, 401);

  const allowed = await handle(new Request("https://stage.invalid/api/request-inspection", {
    headers: { authorization: `Basic ${Buffer.from("bench:secret").toString("base64")}` },
  }));
  const inspection = await allowed.json() as { headers: Record<string, string | undefined> };
  assert.equal(inspection.headers.authorization, undefined);
});

test("the Netlify loader derives the deployed origin and locks authoring off", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "overlay-bench-netlify-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "bench.config.json");
  await writeFile(configPath, JSON.stringify({
    upstream: { origin: "https://production.invalid", websocket: true },
    development: {
      enabled: true,
      inspector: true,
      liveReload: true,
      allowScaffolding: true,
    },
  }));

  const load = createNetlifyConfigLoader({ BENCH_CONFIG_PATH: configPath });
  const config = await load(new Request("https://preview--bench.netlify.app/checkout"));

  assert.equal(config.server.publicOrigin, "https://preview--bench.netlify.app");
  assert.equal(config.upstream.origin, "https://production.invalid");
  assert.deepEqual(config.development, {
    enabled: false,
    inspector: false,
    liveReload: false,
    allowScaffolding: false,
  });
  assert.equal(config.upstream.websocket, false);
});

test("a misconfigured Netlify deployment fails closed with a useful status", async (context) => {
  context.mock.method(console, "error", () => {});
  const directory = await mkdtemp(join(tmpdir(), "overlay-bench-netlify-empty-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const handle = createFetchBenchHandler({
    loadConfig: createNetlifyConfigLoader({
      BENCH_CONFIG_PATH: join(directory, "missing.json"),
    }),
    runtime: "netlify",
    environment: {},
  });

  const response = await handle(new Request("https://bench.netlify.app/"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Mirrorling is not correctly configured for this deployment.",
  });
});
