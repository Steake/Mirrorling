import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createProductionFixture } from "../dist/fixtures/production.js";
import { resolveBenchConfig } from "../dist/src/config.js";
import { createBench } from "../dist/src/server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = JSON.parse(
  await readFile(resolve(root, "examples/demo/demo.config.json"), "utf8"),
);

const fixture = createProductionFixture(0);
let bench;
let browser;

try {
  await fixture.listen();
  raw.server.port = 0;
  raw.server.publicOrigin = "http://127.0.0.1:4173";
  raw.upstream.origin = fixture.origin;
  raw.development = {
    enabled: true,
    inspector: true,
    liveReload: false,
    allowScaffolding: true,
  };

  const config = resolveBenchConfig(raw, resolve(root, "examples/demo"), {
    ...process.env,
    BENCH_DEV_MODE: "1",
  });
  bench = createBench(config);
  await bench.listen();

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  await page.goto(`${bench.origin}/checkout?__bench_scenario=baseline`, {
    waitUntil: "networkidle",
  });
  await page.locator("#__overlay_bench_devtools").locator('[data-action="inspect"]').click();
  await page.locator("#production-offer").click();
  await page.locator("#__overlay_bench_devtools").locator("text=Selector candidates").waitFor();

  const target = resolve(root, "docs/mirrorling-inspector.png");
  await mkdir(dirname(target), { recursive: true });
  await page.screenshot({ path: target });
  console.log(`[docs] Captured ${target}`);
} finally {
  await browser?.close();
  await bench?.close();
  await fixture.close();
}
