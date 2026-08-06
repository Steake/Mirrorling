import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolveBenchConfig } from "../../src/config.js";
import { scaffoldProject } from "../../src/dev-project.js";

test("the authoring workflow generates three distinct, editable scaffold types", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "overlay-bench-authoring-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const config = resolveBenchConfig(
    {
      server: { port: 4173, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      scenarios: [{ id: "baseline", title: "Production", default: true }],
    },
    directory,
    { BENCH_DEV_MODE: "1" },
  );
  config.configPath = join(directory, "bench.config.json");

  const element = await scaffoldProject(config, {
    kind: "element-override",
    selector: "#checkout-summary",
    expectedCount: 1,
    tag: "section",
    outerHTML: '<section id="checkout-summary">Production summary</section>',
    pagePath: "/checkout",
    scenario: "baseline",
  });
  assert.equal(element.scenario, "dev");
  assert.ok(element.files.some((file) => file.endsWith("template.hbs")));

  await scaffoldProject(config, {
    kind: "injected-script",
    name: "checkout flow",
    pagePath: "/checkout",
    scenario: "baseline",
  });
  await scaffoldProject(config, {
    kind: "script-override",
    scriptUrl: "https://stage.invalid/assets/checkout.js",
    source: "window.productionBundle = 'copied';",
    pagePath: "/checkout",
    scenario: "baseline",
  });

  const rawText = await readFile(config.configPath, "utf8");
  const raw = JSON.parse(rawText) as { scenarios: Array<Record<string, unknown>> };
  const dev = raw.scenarios.find((scenario) => scenario.id === "dev")!;
  assert.equal((dev.elementOverrides as unknown[]).length, 1);
  assert.equal((dev.injectedScripts as unknown[]).length, 1);
  assert.equal((dev.injectedStyles as unknown[]).length, 1);
  assert.equal((dev.scriptOverrides as unknown[]).length, 1);
  assert.equal("htmlRules" in dev, false);
  assert.doesNotMatch(rawText, /\.ya?ml/i);
  assert.match(await readFile(join(directory, "injections", "checkout-flow.js"), "utf8"), /Independent staging behaviour/);
  assert.match(await readFile(join(directory, "script-overrides", "checkout.js"), "utf8"), /productionBundle/);
});
