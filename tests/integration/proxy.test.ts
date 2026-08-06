import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import test from "node:test";
import { resolve } from "node:path";
import { resolveBenchConfig } from "../../src/config.js";
import { createBench, type BenchLogger } from "../../src/server.js";
import { createProductionFixture } from "../../fixtures/production.js";

const quietLogger: BenchLogger = {
  info() {},
  warn() {},
  error() {},
};

function rawUpgrade(origin: string, headers: Record<string, string> = {}): Promise<string> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname);
    let response = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(response);
    };
    socket.setTimeout(3_000, () => finish(new Error("WebSocket upgrade timed out.")));
    socket.once("connect", () => {
      const request = [
        "GET /socket HTTP/1.1",
        `Host: ${url.host}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ].join("\r\n");
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) finish();
    });
    socket.once("end", () => finish());
    socket.once("error", finish);
  });
}

test("proxies production, overlays a scenario, mocks routes and exits to production", async (context) => {
  const fixture = createProductionFixture(0);
  await fixture.listen();
  context.after(async () => fixture.close());

  const config = resolveBenchConfig(
    {
      server: {
        host: "127.0.0.1",
        port: 0,
        publicOrigin: "http://127.0.0.1:0",
      },
      upstream: { origin: fixture.origin },
      security: { stripCsp: true, disableServiceWorkers: true },
      html: {
        directAssets: [{ selector: "img[src]", attribute: "src" }],
      },
      scenarios: [
        {
          id: "variant",
          title: "Variant",
          description: "Integration scenario",
          default: true,
          elementOverrides: [
            {
              match: "/checkout",
              operations: [
                {
                  type: "inner",
                  selector: "#production-offer",
                  html: "<h2>Integrated overlay</h2>",
                },
              ],
            },
          ],
          injectedScripts: [],
          injectedStyles: [],
          scriptOverrides: [],
          routeOverrides: [
            {
              match: "/api/recommendation",
              methods: ["GET"],
              status: 200,
              headers: {},
              json: { source: "bench" },
              delayMs: 0,
            },
          ],
          handoffs: [
            {
              id: "done",
              match: "/flow/complete",
              destination: "/account",
              preservePath: false,
              preserveQuery: false,
              status: 302,
              carryQuery: ["plan"],
              clientState: {
                transport: "none",
                parameter: "bench_state",
                stateKeys: [],
              },
            },
          ],
        },
      ],
    },
    resolve("."),
  );
  const bench = createBench(config, quietLogger);
  await bench.listen();
  context.after(async () => bench.close());

  const page = await fetch(`${bench.origin}/checkout`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-security-policy"), null);
  assert.equal(page.headers.get("x-overlay-bench"), "1");
  assert.match(page.headers.get("set-cookie") ?? "", /fixture_session=production-copy/);
  assert.doesNotMatch(page.headers.get("set-cookie") ?? "", /Secure/);
  const html = await page.text();
  assert.match(html, /Integrated overlay/);
  assert.match(html, /data-overlay-bench-runtime/);
  assert.match(html, new RegExp(`src="${fixture.origin.replaceAll(".", "\\.")}\/assets\/mark\.svg"`));

  const mocked = await fetch(`${bench.origin}/api/recommendation`);
  assert.deepEqual(await mocked.json(), { source: "bench" });

  const inspected = await fetch(`${bench.origin}/api/request-inspection`, {
    headers: {
      cookie: "__overlay_bench_scenario=variant; customer=abc",
      "x-bench-scenario": "variant",
    },
  });
  const inspection = (await inspected.json()) as {
    headers: Record<string, string | undefined>;
  };
  assert.equal(inspection.headers["x-bench-scenario"], undefined);
  assert.equal(inspection.headers.cookie, "customer=abc");

  const handoff = await fetch(`${bench.origin}/flow/complete?plan=pro&discard=yes`, {
    redirect: "manual",
  });
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.get("location"), `${fixture.origin}/account?plan=pro`);

  const redirected = await fetch(`${bench.origin}/redirect-me`, { redirect: "manual" });
  assert.equal(redirected.headers.get("location"), `${bench.origin}/account`);

  const selection = await fetch(`${bench.origin}/?__bench_scenario=variant`, {
    redirect: "manual",
  });
  assert.equal(selection.status, 302);
  assert.match(selection.headers.get("set-cookie") ?? "", /__overlay_bench_scenario=variant/);
});

test("WebSocket upgrades enforce staging access and strip bench credentials upstream", async (context) => {
  let resolveHeaders: (headers: Record<string, string | string[] | undefined>) => void;
  const receivedHeaders = new Promise<Record<string, string | string[] | undefined>>((resolve) => {
    resolveHeaders = resolve;
  });
  let upstreamUpgrades = 0;
  const upstream = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  upstream.on("upgrade", (request, socket) => {
    upstreamUpgrades += 1;
    resolveHeaders(request.headers);
    socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", () => {
      upstream.off("error", reject);
      resolve();
    });
  });
  context.after(async () => new Promise<void>((resolve, reject) => {
    upstream.close((error) => error ? reject(error) : resolve());
  }));
  const address = upstream.address() as AddressInfo;

  const usernameEnv = "BENCH_TEST_WS_USER";
  const passwordEnv = "BENCH_TEST_WS_PASSWORD";
  const previousUsername = process.env[usernameEnv];
  const previousPassword = process.env[passwordEnv];
  process.env[usernameEnv] = "author";
  process.env[passwordEnv] = "secret";
  context.after(() => {
    if (previousUsername === undefined) delete process.env[usernameEnv];
    else process.env[usernameEnv] = previousUsername;
    if (previousPassword === undefined) delete process.env[passwordEnv];
    else process.env[passwordEnv] = previousPassword;
  });

  const config = resolveBenchConfig({
    server: {
      host: "127.0.0.1",
      port: 0,
      publicOrigin: "http://127.0.0.1:0",
      access: { enabled: true, usernameEnv, passwordEnv },
    },
    upstream: {
      origin: `http://127.0.0.1:${address.port}`,
      websocket: true,
    },
    scenarios: [{ id: "baseline", title: "Baseline", default: true }],
  }, process.cwd());
  const bench = createBench(config, quietLogger);
  await bench.listen();
  context.after(async () => bench.close());

  const denied = await rawUpgrade(bench.origin);
  assert.match(denied, /^HTTP\/1\.1 401 Unauthorized/);
  assert.equal(upstreamUpgrades, 0);

  const authorization = `Basic ${Buffer.from("author:secret").toString("base64")}`;
  const accepted = await rawUpgrade(bench.origin, {
    Authorization: authorization,
    Cookie: "__overlay_bench_scenario=baseline; customer=abc",
    Origin: bench.origin,
    Referer: `${bench.origin}/checkout`,
    "X-Bench-Scenario": "baseline",
  });
  assert.match(accepted, /^HTTP\/1\.1 101 Switching Protocols/);

  const headers = await receivedHeaders;
  assert.equal(headers.authorization, undefined);
  assert.equal(headers["x-bench-scenario"], undefined);
  assert.equal(headers.cookie, "customer=abc");
  assert.equal(headers.origin, config.upstream.origin);
  assert.equal(headers.referer, `${config.upstream.origin}/checkout`);
});
