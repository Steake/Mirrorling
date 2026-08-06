import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadBenchConfig } from "../../src/config.js";

test("the demo configuration uses the untouched baseline when no scenario is selected", async () => {
  const config = await loadBenchConfig(resolve("examples/demo/demo.config.json"));
  const selected = config.scenarios.find((scenario) => scenario.default);

  assert.equal(selected?.id, "baseline");
  assert.deepEqual(selected?.elementOverrides, []);
  assert.deepEqual(selected?.injectedScripts, []);
  assert.deepEqual(selected?.scriptOverrides, []);
  assert.deepEqual(selected?.routeOverrides, []);
  assert.deepEqual(selected?.handoffs, []);
});
