import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createProductionFixture } from "../../fixtures/production.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function waitForText(
  child: ChildProcess,
  expected: string,
  timeoutMs = 10_000,
): Promise<string> {
  if (!child.stdout || !child.stderr) {
    return Promise.reject(new Error("Child process output is not piped."));
  }
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${expected}. stderr: ${errors}`));
    }, timeoutMs);
    childStdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
    childStderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timeout);
        reject(new Error(`CLI exited with ${code}. stderr: ${errors}`));
      }
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode === 0 || child.signalCode === "SIGTERM") {
      return Promise.resolve();
    }
    return Promise.reject(
      new Error(`Child exited with code ${child.exitCode} and signal ${child.signalCode}.`),
    );
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") resolve();
      else reject(new Error(`Child exited with code ${code} and signal ${signal}.`));
    });
  });
}

test("one command mirrors an arbitrary production URL with baseline behaviour", async (context) => {
  const fixture = createProductionFixture(0);
  await fixture.listen();
  context.after(async () => fixture.close());
  const port = await availablePort();
  const publicOrigin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "--temporary",
      `${fixture.origin}/checkout`,
      "--port",
      String(port),
      "--public-origin",
      publicOrigin,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  context.after(() => {
    if (!child.killed) child.kill("SIGTERM");
  });

  const output = await waitForText(child, `[mirrorling] Open ${publicOrigin}/checkout`);
  assert.match(output, /Controls .*\/__bench\//);
  const html = await fetch(`${publicOrigin}/checkout`).then((response) => response.text());
  assert.match(html, /Original production offer/);
  assert.doesNotMatch(html, /A sharper checkout/);
  assert.match(html, /data-overlay-bench-runtime/);

  child.kill("SIGTERM");
  await waitForExit(child);
});

test("the non-interactive setup command writes a ready baseline configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "overlay-bench-setup-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "bench.config.json");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/setup.ts",
      "--production",
      "https://production.invalid/checkout?plan=pro",
      "--public-origin",
      "https://staging.invalid",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--config",
      configPath,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = await waitForText(
    child,
    "Open: https://staging.invalid/checkout?plan=pro",
  );
  assert.match(output, /Start with: npm start/);
  await waitForExit(child);

  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    upstream: { origin: string };
    server: { publicOrigin: string };
    scenarios: Array<{ id: string; default: boolean }>;
  };
  assert.equal(config.upstream.origin, "https://production.invalid");
  assert.equal(config.server.publicOrigin, "https://staging.invalid");
  assert.deepEqual(config.scenarios, [
    {
      id: "baseline",
      title: "Production mirror",
      description: "Production mirrored without experiment overlays.",
      default: true,
      vars: {},
      elementOverrides: [],
      injectedScripts: [],
      injectedStyles: [],
      scriptOverrides: [],
      routeOverrides: [],
      handoffs: [],
    },
  ]);
});
