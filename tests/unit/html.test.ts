import assert from "node:assert/strict";
import test from "node:test";
import { resolveBenchConfig } from "../../src/config.js";
import { transformHtml } from "../../src/html.js";

test("rewrites production URLs, applies DOM operations and injects the runtime", async () => {
  const config = resolveBenchConfig(
    {
      server: { port: 4444, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      html: {
        directAssets: [{ selector: "img[src]", attribute: "src" }],
      },
      scenarios: [
        {
          id: "variant",
          default: true,
          title: "Variant",
          description: "",
          elementOverrides: [
            {
              match: "/checkout",
              operations: [
                {
                  type: "inner",
                  selector: "#offer",
                  html: "<strong>Staged</strong>",
                },
              ],
            },
          ],
          injectedScripts: [],
          injectedStyles: [],
          scriptOverrides: [],
          routeOverrides: [],
          handoffs: [],
        },
      ],
    },
    process.cwd(),
  );
  const scenario = config.scenarios[0]!;
  const output = await transformHtml({
    html: '<!doctype html><html><head></head><body><a href="https://prod.invalid/account">A</a><img src="https://prod.invalid/i.png"><div id="offer">Prod</div></body></html>',
    requestUrl: new URL("https://stage.invalid/checkout"),
    scenario,
    config,
  });

  assert.match(output, /data-overlay-bench-runtime/);
  assert.match(output, /data-overlay-bench-scenario="variant"/);
  assert.match(output, /href="https:\/\/stage\.invalid\/account"/);
  assert.match(output, /src="https:\/\/prod\.invalid\/i\.png"/);
  assert.match(output, /<div id="offer"><strong>Staged<\/strong><\/div>/);
});
