import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import * as cheerio from "cheerio";
import { resolveBenchConfig } from "../../src/config.js";
import { transformHtml } from "../../src/html.js";

test("the injected browser runtime performs an allowlisted client-only handoff", async () => {
  const config = resolveBenchConfig(
    {
      server: { port: 4444, publicOrigin: "https://stage.invalid" },
      upstream: { origin: "https://prod.invalid" },
      scenarios: [
        {
          id: "flow",
          title: "Flow",
          description: "",
          default: true,
          elementOverrides: [],
          injectedScripts: [],
          injectedStyles: [],
          scriptOverrides: [],
          routeOverrides: [],
          handoffs: [
            {
              id: "finish",
              match: "/never",
              destination: "/account",
              preservePath: false,
              preserveQuery: false,
              status: 302,
              carryQuery: ["ref"],
              clientState: {
                transport: "query",
                parameter: "bench_state",
                stateKeys: ["plan"],
              },
            },
          ],
        },
      ],
    },
    process.cwd(),
  );
  const transformed = await transformHtml({
    html: "<!doctype html><html><head></head><body></body></html>",
    requestUrl: new URL("https://stage.invalid/checkout?ref=abc"),
    scenario: config.scenarios[0]!,
    config,
  });
  const $ = cheerio.load(transformed);
  const script = $("script[data-overlay-bench-runtime]").html();
  assert.ok(script);

  const assigned: string[] = [];
  const location = {
    href: "https://stage.invalid/checkout?ref=abc",
    pathname: "/checkout",
    protocol: "https:",
    host: "stage.invalid",
    assign(value: string) {
      assigned.push(value);
    },
  };
  class ElementStub {}
  class FormStub extends ElementStub {}
  class EventStub {
    constructor(
      public readonly type: string,
      public readonly init?: unknown,
    ) {}
  }
  const windowObject: Record<string, unknown> = {
    name: "",
    location,
    dispatchEvent() {},
  };
  const context = vm.createContext({
    window: windowObject,
    location,
    document: { addEventListener() {} },
    navigator: {},
    Element: ElementStub,
    HTMLFormElement: FormStub,
    CustomEvent: EventStub,
    URL,
    URLSearchParams,
    console,
  });
  vm.runInContext(script, context);

  const api = windowObject.__MIRRORLING__ as {
    handoff(id: string, options: { state: Record<string, string> }): string;
  };
  api.handoff("finish", { state: { plan: "pro", rejected: "secret" } });
  assert.equal(assigned.length, 1);
  const destination = new URL(assigned[0]!);
  assert.equal(destination.origin, "https://prod.invalid");
  assert.equal(destination.pathname, "/account");
  assert.equal(destination.searchParams.get("ref"), "abc");
  const envelope = JSON.parse(destination.searchParams.get("bench_state") ?? "{}");
  assert.deepEqual(JSON.parse(JSON.stringify(envelope)), {
    version: 1,
    scenario: "flow",
    handoff: "finish",
    state: { plan: "pro" },
  });
});
