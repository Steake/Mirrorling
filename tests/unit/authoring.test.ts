import assert from "node:assert/strict";
import test from "node:test";
import * as cheerio from "cheerio";
import { resolveBenchConfig } from "../../src/config.js";
import { transformHtml } from "../../src/html.js";

test("renders per-element Handlebars overrides with page, request and scenario intel", async () => {
  const config = resolveBenchConfig(
    {
      server: { port: 4444, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      scenarios: [{
        id: "template",
        default: true,
        vars: { offer: "<strong>Plus</strong>" },
        elementOverrides: [{
          match: "/checkout",
          operations: [{
            id: "offer-template",
            type: "replace",
            selector: ".offer",
            template: true,
            expect: { count: 2, tag: "section" },
            html: `<article data-kind="{{attr "#source" "data-kind"}}">
              <h2>{{original.text}}</h2><p>{{text "#reference"}}</p>
              <i>{{vars.offer}}</i><b>{{query "plan"}}</b>
              <a href="{{productionUrl "/account"}}">Continue</a>
              <div>{{html "#reference"}}</div>
            </article>`,
          }],
        }],
      }],
    },
    process.cwd(),
  );
  const output = await transformHtml({
    html: '<html><head></head><body><div id="source" data-kind="live"></div><div id="reference"><em>Reference</em></div><section class="offer">First</section><section class="offer">Second</section></body></html>',
    requestUrl: new URL("https://stage.invalid/checkout?plan=pro"),
    scenario: config.scenarios[0]!,
    config,
  });
  const $ = cheerio.load(output);
  assert.deepEqual($("article h2").toArray().map((node) => $(node).text().trim()), ["First", "Second"]);
  assert.equal($("article").first().attr("data-kind"), "live");
  assert.equal($("article i").first().html(), "&lt;strong&gt;Plus&lt;/strong&gt;");
  assert.equal($("article b").first().text(), "pro");
  assert.equal($("article a").first().attr("href"), "https://prod.invalid/account");
  assert.equal($("article div em").first().text(), "Reference");
});

test("selector contracts fail open and surface diagnostics in the inspector", async () => {
  const config = resolveBenchConfig(
    {
      server: { port: 4444, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      development: { enabled: true, inspector: true, liveReload: true, allowScaffolding: true },
      scenarios: [{
        id: "contract",
        default: true,
        elementOverrides: [{
          match: "/**",
          operations: [{
            id: "single-hero",
            type: "inner",
            selector: ".hero",
            html: "Changed",
            expect: { count: 1 },
            onMismatch: "skip",
          }],
        }],
      }],
    },
    process.cwd(),
    { BENCH_DEV_MODE: "1" },
  );
  const output = await transformHtml({
    html: '<html><head></head><body><div class="hero">One</div><div class="hero">Two</div></body></html>',
    requestUrl: new URL("https://stage.invalid/"),
    scenario: config.scenarios[0]!,
    config,
    devToken: "test-token",
  });
  const $ = cheerio.load(output);
  assert.deepEqual($(".hero").toArray().map((node) => $(node).text()), ["One", "Two"]);
  const devScript = $("script[data-overlay-bench-dev-client]").html();
  assert.ok(devScript);
  assert.match(devScript, /Expected 1 match\(es\), found 2/);
  assert.match(devScript, /selectorCandidates/);
  assert.doesNotThrow(() => new Function(devScript));
});

test("independent injected scripts keep their own lifecycle and are not element overrides", async () => {
  const config = resolveBenchConfig(
    {
      server: { port: 4444, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      scenarios: [{
        id: "separate",
        default: true,
        elementOverrides: [{
          match: "/flow",
          operations: [{ type: "inner", selector: "#surface", html: "Overridden" }],
        }],
        injectedScripts: [{
          id: "flow-behaviour",
          match: "/flow",
          timing: "dom-ready",
          content: "window.flowInjection = true;",
        }],
      }],
    },
    process.cwd(),
  );
  const scenario = config.scenarios[0]!;
  assert.equal(scenario.elementOverrides.length, 1);
  assert.equal(scenario.injectedScripts.length, 1);
  const output = await transformHtml({
    html: '<html><head></head><body><div id="surface">Production</div></body></html>',
    requestUrl: new URL("https://stage.invalid/flow"),
    scenario,
    config,
  });
  const $ = cheerio.load(output);
  assert.equal($("#surface").text(), "Overridden");
  const injection = $('script[data-overlay-bench-injected="flow-behaviour"]').html() ?? "";
  assert.match(injection, /DOMContentLoaded/);
  assert.match(injection, /window\.flowInjection = true/);
});
