import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolveBenchConfig } from "../../src/config.js";
import { createBench, type BenchLogger } from "../../src/server.js";
import { createProductionFixture } from "../../fixtures/production.js";

const quietLogger: BenchLogger = { info() {}, warn() {}, error() {} };

test("production script overrides replace, prepend and append without becoming injections", async (context) => {
  let productionOrigin = "http://127.0.0.1:0";
  const production = createServer((request, response) => {
    const url = new URL(request.url ?? "/", productionOrigin);
    if (url.pathname.endsWith(".js")) {
      const body = `window.trace=(window.trace||[]).concat("production:${url.pathname}");`;
      response.writeHead(200, { "content-type": "application/javascript", "content-length": String(Buffer.byteLength(body)) });
      response.end(body);
      return;
    }
    const body = `<!doctype html><html><head></head><body>
      <script integrity="sha256-old" src="${productionOrigin}/assets/replace.js"></script>
      <script integrity="sha256-old" src="${productionOrigin}/assets/prepend.js"></script>
      <script integrity="sha256-old" src="${productionOrigin}/assets/append.js"></script>
    </body></html>`;
    response.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(body)) });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    production.once("error", reject);
    production.listen(0, "127.0.0.1", () => {
      production.off("error", reject);
      productionOrigin = `http://127.0.0.1:${(production.address() as AddressInfo).port}`;
      resolve();
    });
  });
  context.after(() => new Promise<void>((resolve, reject) => production.close((error) => error ? reject(error) : resolve())));

  const config = resolveBenchConfig({
    server: { host: "127.0.0.1", port: 0, publicOrigin: "http://127.0.0.1:0" },
    upstream: { origin: productionOrigin },
    scenarios: [{
      id: "scripts",
      default: true,
      injectedScripts: [{ id: "independent", match: "/", timing: "body-end", content: "window.independent=true;" }],
      scriptOverrides: [
        { id: "replace", match: "/assets/replace.js", strategy: "replace", content: "window.trace=['replace'];" },
        { id: "prepend", match: "/assets/prepend.js", strategy: "prepend", content: "window.trace=['prepend'];" },
        { id: "append", match: "/assets/append.js", strategy: "append", content: "window.trace=['append'];" },
      ],
    }],
  }, process.cwd());
  const bench = createBench(config, quietLogger);
  await bench.listen();
  context.after(async () => bench.close());

  const html = await fetch(`${bench.origin}/`).then((response) => response.text());
  assert.equal((html.match(/data-overlay-bench-script-override/g) ?? []).length, 3);
  assert.doesNotMatch(html, /integrity="sha256-old"/);
  assert.match(html, /data-overlay-bench-injected="independent"/);

  const replaced = await fetch(`${bench.origin}/assets/replace.js`).then((response) => response.text());
  assert.match(replaced, /\['replace'\]/);
  assert.doesNotMatch(replaced, /production:\/assets\/replace/);
  const prepended = await fetch(`${bench.origin}/assets/prepend.js`).then((response) => response.text());
  assert.ok(prepended.indexOf("['prepend']") < prepended.indexOf("production:/assets/prepend.js"));
  const appended = await fetch(`${bench.origin}/assets/append.js`).then((response) => response.text());
  assert.ok(appended.indexOf("production:/assets/append.js") < appended.indexOf("['append']"));
});

test("live reload uses a browser event stream", async (context) => {
  const config = resolveBenchConfig({
    server: { host: "127.0.0.1", port: 0, publicOrigin: "http://127.0.0.1:0" },
    upstream: { origin: "http://127.0.0.1:9" },
    development: { enabled: true, inspector: true, liveReload: true, allowScaffolding: true },
  }, process.cwd(), { BENCH_DEV_MODE: "1" });
  const bench = createBench(config, quietLogger);
  await bench.listen();
  context.after(async () => bench.close());

  const payload = await new Promise<string>((resolve, reject) => {
    let notified = false;
    const request = get(`${bench.origin}/__bench/events`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (!notified && body.includes("overlay-bench live reload")) {
          notified = true;
          bench.notifyReload("template.hbs");
        }
        if (body.includes("event: reload")) {
          request.destroy();
          resolve(body);
        }
      });
      response.on("error", reject);
    });
    request.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
  });
  assert.match(payload, /template\.hbs/);
});

test("the in-page authoring token can scaffold a selected production element", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "overlay-bench-api-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const fixture = createProductionFixture(0);
  await fixture.listen();
  context.after(async () => fixture.close());
  const config = resolveBenchConfig({
    server: { host: "127.0.0.1", port: 0, publicOrigin: "http://127.0.0.1:0" },
    upstream: { origin: fixture.origin },
    development: { enabled: true, inspector: true, liveReload: true, allowScaffolding: true },
    scenarios: [{ id: "baseline", title: "Production mirror", default: true }],
  }, directory, { BENCH_DEV_MODE: "1" });
  config.configPath = join(directory, "bench.config.json");
  const bench = createBench(config, quietLogger);
  await bench.listen();
  context.after(async () => bench.close());

  const page = await fetch(`${bench.origin}/checkout`).then((response) => response.text());
  assert.match(page, /data-overlay-bench-dev-client/);
  assert.match(page, /selectorCandidates/);
  const token = page.match(/"token":"([^"]+)"/)?.[1];
  assert.ok(token);

  const denied = await fetch(`${bench.origin}/__bench/api/scaffold`, {
    method: "POST",
    headers: { origin: bench.origin, "content-type": "application/json" },
    body: JSON.stringify({ kind: "injected-script", name: "denied", pagePath: "/checkout", scenario: "baseline" }),
  });
  assert.equal(denied.status, 403);

  const created = await fetch(`${bench.origin}/__bench/api/scaffold`, {
    method: "POST",
    headers: {
      origin: bench.origin,
      "content-type": "application/json",
      "x-bench-dev-token": token,
    },
    body: JSON.stringify({
      kind: "element-override",
      selector: "#production-offer",
      expectedCount: 1,
      tag: "section",
      outerHTML: '<section id="production-offer"><h2>Original production offer</h2></section>',
      pagePath: "/checkout",
      scenario: "baseline",
    }),
  });
  assert.equal(created.status, 201);
  const result = await created.json() as { scenario: string; files: string[] };
  assert.equal(result.scenario, "dev");
  assert.ok(result.files.some((file) => file.endsWith("template.hbs")));
  assert.match(await readFile(config.configPath, "utf8"), /"elementOverrides"/);
});
