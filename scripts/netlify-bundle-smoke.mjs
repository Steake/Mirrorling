import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { createProductionFixture } from "../dist/fixtures/production.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = join(root, ".netlify", "functions", "bench.zip");
const extracted = await mkdtemp(join(tmpdir(), "overlay-bench-netlify-bundle-"));

function safeArchivePath(name) {
  const parts = name.split("/").filter(Boolean);
  if (name.startsWith("/") || parts.includes("..")) {
    throw new Error(`Refusing unsafe archive path: ${name}`);
  }
  return join(extracted, ...parts);
}

const previousUpstream = process.env.BENCH_UPSTREAM_ORIGIN;
const previousPublicOrigin = process.env.BENCH_PUBLIC_ORIGIN;
const fixture = createProductionFixture(0);

try {
  const files = unzipSync(new Uint8Array(await readFile(archive)));
  for (const [name, contents] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    const destination = safeArchivePath(name);
    if (!destination.startsWith(`${extracted}${sep}`)) {
      throw new Error(`Refusing archive path outside extraction root: ${name}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }

  await fixture.listen();
  process.env.BENCH_UPSTREAM_ORIGIN = fixture.origin;
  delete process.env.BENCH_PUBLIC_ORIGIN;

  const wrapper = new TextDecoder().decode(files["___netlify-entry-point.mjs"] ?? new Uint8Array());
  const declaredEntry = /getLambdaHandler\(["']\.\/([^"']+netlify\/functions\/bench\.mjs)["']\)/
    .exec(wrapper)?.[1];
  const candidates = Object.keys(files).filter((name) =>
    name === "netlify/functions/bench.mjs" || name.endsWith("/netlify/functions/bench.mjs"),
  );
  const entryName = declaredEntry ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!entryName) {
    throw new Error(`Could not identify the bundled Mirrorling entry point (${candidates.length} candidates).`);
  }
  const entry = safeArchivePath(entryName);
  const module = await import(`${pathToFileURL(entry).href}?smoke=${Date.now()}`);
  assert.equal(typeof module.default, "function");

  const health = await module.default(
    new Request("https://preview.invalid/__bench/health"),
    {},
  );
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    runtime: "netlify",
    scenario: "baseline",
    upstream: fixture.origin,
    authoring: false,
    websocketProxy: false,
  });

  const page = await module.default(
    new Request("https://preview.invalid/checkout"),
    {},
  );
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-overlay-bench-runtime"), "netlify");
  assert.match(await page.text(), /id="production-offer"/);

  const redirect = await module.default(
    new Request("https://preview.invalid/redirect-me"),
    {},
  );
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://preview.invalid/account");

  console.log("Bundled Netlify function smoke test passed.");
} finally {
  await fixture.close();
  await rm(extracted, { recursive: true, force: true });
  if (previousUpstream === undefined) delete process.env.BENCH_UPSTREAM_ORIGIN;
  else process.env.BENCH_UPSTREAM_ORIGIN = previousUpstream;
  if (previousPublicOrigin === undefined) delete process.env.BENCH_PUBLIC_ORIGIN;
  else process.env.BENCH_PUBLIC_ORIGIN = previousPublicOrigin;
}
