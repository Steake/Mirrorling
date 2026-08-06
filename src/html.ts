import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import Handlebars from "handlebars";
import { devClientScript } from "./dev-client.js";
import { matchesRequest } from "./matcher.js";
import type {
  BenchConfig,
  HandoffRule,
  HtmlOperation,
  Scenario,
  TransformDiagnostic,
} from "./types.js";

export interface TransformInput {
  html: string;
  requestUrl: URL;
  scenario: Scenario;
  config: BenchConfig;
  devToken?: string;
}

interface RuntimeHandoff {
  id: string;
  destination: string;
  preservePath: boolean;
  preserveQuery: boolean;
  carryQuery: string[];
  clientState: HandoffRule["clientState"];
}

function escapeClosingTag(content: string, tag: "script" | "style"): string {
  return content.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sameOriginUrl(
  value: string,
  base: URL,
  sourceOrigin: string,
  targetOrigin: string,
): string {
  if (!value || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) {
    return value;
  }
  try {
    const parsed = new URL(value, base);
    if (parsed.origin !== sourceOrigin) return value;
    return `${targetOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function rewriteSrcset(
  value: string,
  base: URL,
  sourceOrigin: string,
  targetOrigin: string,
): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      const separator = trimmed.search(/\s/);
      const url = separator < 0 ? trimmed : trimmed.slice(0, separator);
      const descriptor = separator < 0 ? "" : trimmed.slice(separator);
      return `${sameOriginUrl(url, base, sourceOrigin, targetOrigin)}${descriptor}`;
    })
    .join(", ");
}

function rewriteAttribute(
  $: cheerio.CheerioAPI,
  selector: string,
  attribute: string,
  base: URL,
  sourceOrigin: string,
  targetOrigin: string,
): void {
  $(selector).each((_index, node) => {
    const element = $(node);
    const current = element.attr(attribute);
    if (!current) return;
    element.attr(
      attribute,
      attribute.toLowerCase() === "srcset"
        ? rewriteSrcset(current, base, sourceOrigin, targetOrigin)
        : sameOriginUrl(current, base, sourceOrigin, targetOrigin),
    );
  });
}

function annotateScriptOverrides(
  $: cheerio.CheerioAPI,
  input: TransformInput,
): void {
  const upstreamPage = new URL(
    `${input.requestUrl.pathname}${input.requestUrl.search}`,
    input.config.upstream.origin,
  );
  const origins = new Set([
    new URL(input.config.upstream.origin).origin,
    new URL(input.config.server.publicOrigin).origin,
  ]);
  $("script[src]").each((_index, node) => {
    const script = $(node);
    const source = script.attr("src");
    if (!source) return;
    try {
      const url = new URL(source, upstreamPage);
      if (!origins.has(url.origin)) return;
      const override = input.scenario.scriptOverrides.find((candidate) =>
        matchesRequest(candidate, url.pathname, "GET"),
      );
      if (!override) return;
      if (url.origin === new URL(input.config.upstream.origin).origin) {
        script.attr("src", `${new URL(input.config.server.publicOrigin).origin}${url.pathname}${url.search}${url.hash}`);
      }
      script.removeAttr("integrity");
      script.attr("data-overlay-bench-script-override", override.id);
    } catch {
      // An invalid production script URL is left untouched.
    }
  });
}

function rewriteDocumentUrls(
  $: cheerio.CheerioAPI,
  requestUrl: URL,
  config: BenchConfig,
): void {
  const upstreamUrl = new URL(
    `${requestUrl.pathname}${requestUrl.search}`,
    config.upstream.origin,
  );
  const upstreamOrigin = new URL(config.upstream.origin).origin;
  const stagingOrigin = new URL(config.server.publicOrigin).origin;
  const proxiedAttributes: Array<[string, string]> = [
    ["a[href]:not([data-bench-production])", "href"],
    ["form[action]:not([data-bench-production])", "action"],
    ["script[src]", "src"],
    ["link[href]:not([rel='canonical'])", "href"],
    ["img[src]", "src"],
    ["img[srcset]", "srcset"],
    ["source[src]", "src"],
    ["source[srcset]", "srcset"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["iframe[src]", "src"],
    ["base[href]", "href"],
  ];
  for (const [selector, attribute] of proxiedAttributes) {
    rewriteAttribute($, selector, attribute, upstreamUrl, upstreamOrigin, stagingOrigin);
  }
  for (const rule of config.html.directAssets) {
    rewriteAttribute(
      $,
      rule.selector,
      rule.attribute,
      new URL(`${requestUrl.pathname}${requestUrl.search}`, stagingOrigin),
      stagingOrigin,
      upstreamOrigin,
    );
  }
}

async function operationSource(operation: HtmlOperation): Promise<string> {
  if (operation.file) return readFile(operation.file, "utf8");
  return operation.html ?? operation.value ?? "";
}

function templateContext(
  $: cheerio.CheerioAPI,
  node: AnyNode,
  input: TransformInput,
): Record<string, unknown> {
  const element = $(node);
  const domElement = node as Element;
  return {
    original: {
      html: element.html() ?? "",
      outerHtml: $.html(node),
      text: element.text(),
      attributes: { ...(domElement.attribs ?? {}) },
      tag: domElement.name ?? "",
    },
    request: {
      url: input.requestUrl.href,
      path: input.requestUrl.pathname,
      query: Object.fromEntries(input.requestUrl.searchParams),
    },
    scenario: {
      id: input.scenario.id,
      title: input.scenario.title,
      vars: input.scenario.vars,
    },
    vars: input.scenario.vars,
    production: { origin: new URL(input.config.upstream.origin).origin },
    staging: { origin: new URL(input.config.server.publicOrigin).origin },
  };
}

function renderTemplate(
  source: string,
  $: cheerio.CheerioAPI,
  node: AnyNode,
  input: TransformInput,
): string {
  const handlebars = Handlebars.create();
  const stringValue = (value: unknown): string =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  handlebars.registerHelper("text", (selector: unknown) => $(stringValue(selector)).first().text());
  handlebars.registerHelper("html", (selector: unknown) =>
    new handlebars.SafeString($(stringValue(selector)).first().html() ?? ""),
  );
  handlebars.registerHelper("attr", (selector: unknown, name: unknown) =>
    $(stringValue(selector)).first().attr(stringValue(name)) ?? "",
  );
  handlebars.registerHelper("query", (name: unknown) =>
    input.requestUrl.searchParams.get(stringValue(name)) ?? "",
  );
  handlebars.registerHelper("productionUrl", (path: unknown) =>
    new URL(stringValue(path), input.config.upstream.origin).href,
  );
  handlebars.registerHelper("stagingUrl", (path: unknown) =>
    new URL(stringValue(path), input.config.server.publicOrigin).href,
  );
  handlebars.registerHelper("json", (value: unknown) =>
    new handlebars.SafeString(JSON.stringify(value).replaceAll("<", "\\u003c")),
  );
  return handlebars.compile(source, { noEscape: false })(templateContext($, node, input));
}

function expectedMismatch(
  selection: cheerio.Cheerio<AnyNode>,
  operation: HtmlOperation,
): string | undefined {
  if (operation.expect?.count !== undefined && selection.length !== operation.expect.count) {
    return `Expected ${operation.expect.count} match(es), found ${selection.length}.`;
  }
  if (operation.expect?.tag) {
    const expected = operation.expect.tag.toLowerCase();
    const incorrect = selection.toArray().filter((node) =>
      (node as Element).name?.toLowerCase() !== expected,
    ).length;
    if (incorrect > 0) return `${incorrect} matched element(s) were not <${expected}>.`;
  }
  if (selection.length === 0) return "Selector matched no elements.";
  return undefined;
}

function applyContent(
  $: cheerio.CheerioAPI,
  node: AnyNode,
  operation: HtmlOperation,
  content: string,
): void {
  const selection = $(node);
  switch (operation.type) {
    case "replace": selection.replaceWith(content); break;
    case "inner": selection.html(content); break;
    case "append": selection.append(content); break;
    case "prepend": selection.prepend(content); break;
    case "before": selection.before(content); break;
    case "after": selection.after(content); break;
    default: break;
  }
}

async function applyOperation(
  $: cheerio.CheerioAPI,
  operation: HtmlOperation,
  input: TransformInput,
  diagnostics: TransformDiagnostic[],
): Promise<void> {
  let selection: cheerio.Cheerio<AnyNode>;
  try {
    selection = $(operation.selector);
  } catch (error) {
    diagnostics.push({
      level: "error",
      kind: "selector",
      id: operation.id ?? operation.selector,
      selector: operation.selector,
      message: `Invalid selector: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  const mismatch = expectedMismatch(selection, operation);
  if (mismatch) {
    const policy = operation.onMismatch ?? "skip";
    diagnostics.push({
      level: policy === "error" ? "error" : "warning",
      kind: "selector",
      id: operation.id ?? operation.selector,
      selector: operation.selector,
      matches: selection.length,
      message: `${mismatch} Policy: ${policy}.`,
    });
    if (policy === "error") throw new Error(`${operation.selector}: ${mismatch}`);
    if (policy === "skip") return;
  }

  if (operation.type === "remove") {
    selection.remove();
    return;
  }
  if (operation.type === "set-attribute") {
    if (!operation.attribute) {
      diagnostics.push({ level: "error", kind: "selector", id: operation.id ?? operation.selector, selector: operation.selector, message: "set-attribute requires an attribute name." });
      return;
    }
    const source = await operationSource(operation);
    for (const node of selection.toArray()) {
      const value = operation.template
        ? renderTemplate(source, $, node, input)
        : operation.value ?? source;
      $(node).attr(operation.attribute, value);
    }
    return;
  }

  const source = await operationSource(operation);
  const templated = operation.template === true || operation.file?.toLowerCase().endsWith(".hbs") === true;
  for (const node of selection.toArray()) {
    try {
      applyContent($, node, operation, templated ? renderTemplate(source, $, node, input) : source);
    } catch (error) {
      diagnostics.push({
        level: "error",
        kind: "template",
        id: operation.id ?? operation.selector,
        selector: operation.selector,
        message: `Template skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function applyElementOverrides(
  $: cheerio.CheerioAPI,
  input: TransformInput,
  diagnostics: TransformDiagnostic[],
): Promise<void> {
  for (const rule of input.scenario.elementOverrides) {
    if (!matchesRequest(rule, input.requestUrl.pathname, "GET")) continue;
    for (const operation of rule.operations) {
      try {
        await applyOperation($, operation, input, diagnostics);
      } catch (error) {
        if (operation.onMismatch === "error") throw error;
        diagnostics.push({
          level: "error",
          kind: "template",
          id: operation.id ?? operation.selector,
          selector: operation.selector,
          message: `Override skipped: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }
}

function wrapScript(content: string, timing: string): string {
  const guarded = `try {\n${content}\n} catch (error) { console.error("[mirrorling] Injected script failed", error); }`;
  if (timing === "dom-ready") {
    return `(() => { const run = () => { ${guarded} }; if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true }); else run(); })();`;
  }
  if (timing === "load") {
    return `(() => { const run = () => { ${guarded} }; if (document.readyState === "complete") run(); else window.addEventListener("load", run, { once: true }); })();`;
  }
  return content;
}

async function applyIndependentInjections(
  $: cheerio.CheerioAPI,
  input: TransformInput,
  diagnostics: TransformDiagnostic[],
): Promise<void> {
  for (const style of input.scenario.injectedStyles) {
    if (!matchesRequest(style, input.requestUrl.pathname, "GET")) continue;
    try {
      const content = style.file ? await readFile(style.file, "utf8") : style.content ?? "";
      $("head").append(`<style data-overlay-bench-style="${escapeAttribute(style.id)}">${escapeClosingTag(content, "style")}</style>`);
    } catch (error) {
      diagnostics.push({ level: "error", kind: "injection", id: style.id, message: `Style skipped: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const scripts = new Map<string, string[]>();
  for (const script of input.scenario.injectedScripts) {
    if (!matchesRequest(script, input.requestUrl.pathname, "GET")) continue;
    try {
      const source = script.file ? await readFile(script.file, "utf8") : script.content ?? "";
      const type = script.module ? ' type="module"' : "";
      const content = wrapScript(source, script.timing);
      const element = `<script${type} data-overlay-bench-injected="${escapeAttribute(script.id)}">${escapeClosingTag(content, "script")}</script>`;
      const group = scripts.get(script.timing) ?? [];
      group.push(element);
      scripts.set(script.timing, group);
    } catch (error) {
      diagnostics.push({ level: "error", kind: "injection", id: script.id, message: `Script skipped: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const joined = (timing: string): string => (scripts.get(timing) ?? []).join("\n");
  const documentStart = joined("document-start");
  if (documentStart) $("script[data-overlay-bench-runtime]").after(documentStart);
  const headEnd = joined("head-end");
  if (headEnd) $("head").append(headEnd);
  const bodyEnd = [joined("body-end"), joined("dom-ready"), joined("load")].filter(Boolean).join("\n");
  if (bodyEnd) $("body").append(bodyEnd);
}

function runtimeScript(input: TransformInput): string {
  const handoffs: RuntimeHandoff[] = input.scenario.handoffs.map((rule) => ({
    id: rule.id,
    destination: rule.destination,
    preservePath: rule.preservePath,
    preserveQuery: rule.preserveQuery,
    carryQuery: rule.carryQuery,
    clientState: rule.clientState,
  }));
  const settings = {
    scenario: input.scenario.id,
    vars: input.scenario.vars,
    stagingOrigin: new URL(input.config.server.publicOrigin).origin,
    productionOrigin: new URL(input.config.upstream.origin).origin,
    navigationGuard: input.config.html.navigationGuard,
    disableServiceWorkers: input.config.security.disableServiceWorkers,
    handoffs,
  };

  return `(() => {
  "use strict";
  const settings = ${JSON.stringify(settings).replaceAll("<", "\\u003c")};
  const rules = new Map(settings.handoffs.map((rule) => [rule.id, rule]));
  const filteredState = (rule, state) => {
    const source = state && typeof state === "object" ? state : {};
    return Object.fromEntries(rule.clientState.stateKeys.filter((key) => Object.prototype.hasOwnProperty.call(source, key)).map((key) => [key, source[key]]));
  };
  const destinationFor = (rule, requestedDestination) => {
    const destination = new URL(requestedDestination || rule.destination, settings.productionOrigin);
    if (destination.origin !== settings.productionOrigin) throw new Error("Handoff destinations must remain on the configured production origin.");
    if (rule.preservePath && !requestedDestination) destination.pathname = location.pathname;
    if (rule.preserveQuery) {
      for (const [name, value] of new URL(location.href).searchParams) if (!name.startsWith("__bench_")) destination.searchParams.append(name, value);
    } else {
      const current = new URL(location.href);
      for (const name of rule.carryQuery) for (const value of current.searchParams.getAll(name)) destination.searchParams.append(name, value);
    }
    return destination;
  };
  const carryClientState = (rule, destination, state) => {
    const carried = filteredState(rule, state);
    if (rule.clientState.transport === "none" || Object.keys(carried).length === 0) return;
    const envelope = { version: 1, scenario: settings.scenario, handoff: rule.id, state: carried };
    const serialized = JSON.stringify(envelope);
    if (rule.clientState.transport === "query") destination.searchParams.set(rule.clientState.parameter, serialized);
    else if (rule.clientState.transport === "fragment") { const fragment = new URLSearchParams(destination.hash.replace(/^#/, "")); fragment.set(rule.clientState.parameter, serialized); destination.hash = fragment.toString(); }
    else if (rule.clientState.transport === "window-name") { let existing = {}; try { const parsed = JSON.parse(window.name || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed; } catch {} window.name = JSON.stringify({ ...existing, [rule.clientState.parameter]: envelope }); }
  };
  const handoff = (ruleId, options = {}) => {
    const rule = rules.get(ruleId);
    if (!rule) throw new Error(\`Unknown handoff rule: \${ruleId}\`);
    const destination = destinationFor(rule, options.destination);
    carryClientState(rule, destination, options.state);
    window.location.assign(destination.href);
    return destination.href;
  };
  const api = Object.freeze({ scenario: settings.scenario, vars: Object.freeze(settings.vars), productionOrigin: settings.productionOrigin, stagingOrigin: settings.stagingOrigin, handoffs: Object.freeze([...rules.keys()]), handoff });
  Object.defineProperty(window, "__MIRRORLING__", { value: api, configurable: false, enumerable: false, writable: false });
  Object.defineProperty(window, "__OVERLAY_BENCH__", { value: api, configurable: false, enumerable: false, writable: false });
  if (settings.disableServiceWorkers && "serviceWorker" in navigator) {
    try { navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((registration) => registration.unregister()))); navigator.serviceWorker.register = () => Promise.reject(new Error("Service workers are disabled by Mirrorling.")); } catch {}
  }
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-bench-handoff]") : null;
    if (target) { event.preventDefault(); let state = {}; try { state = JSON.parse(target.getAttribute("data-bench-state") || "{}"); } catch {} handoff(target.getAttribute("data-bench-handoff"), { destination: target.getAttribute("data-bench-destination") || undefined, state }); return; }
    if (!settings.navigationGuard) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || anchor.hasAttribute("data-bench-production")) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin === settings.productionOrigin) { event.preventDefault(); url.protocol = location.protocol; url.host = location.host; location.assign(url.href); }
  }, true);
  document.addEventListener("submit", (event) => {
    if (!settings.navigationGuard || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    if (form.hasAttribute("data-bench-production")) return;
    const action = new URL(form.action, location.href);
    if (action.origin === settings.productionOrigin) { action.protocol = location.protocol; action.host = location.host; form.action = action.href; }
  }, true);
  window.dispatchEvent(new CustomEvent("mirrorling:ready", { detail: api }));
  window.dispatchEvent(new CustomEvent("overlay-bench:ready", { detail: api }));
})();`;
}

function ensureDocumentContainers($: cheerio.CheerioAPI): void {
  if ($("html").length === 0) $.root().append("<html><head></head><body></body></html>");
  if ($("head").length === 0) $("html").prepend("<head></head>");
  if ($("body").length === 0) $("html").append("<body></body>");
}

export async function transformHtml(input: TransformInput): Promise<string> {
  const $ = cheerio.load(input.html, { xml: false });
  const diagnostics: TransformDiagnostic[] = [];
  ensureDocumentContainers($);
  if (input.config.html.rewriteSameOriginUrls) rewriteDocumentUrls($, input.requestUrl, input.config);
  await applyElementOverrides($, input, diagnostics);
  annotateScriptOverrides($, input);
  $("head").prepend(`<script data-overlay-bench-runtime>${escapeClosingTag(runtimeScript(input), "script")}</script>`);
  await applyIndependentInjections($, input, diagnostics);
  if (input.config.development.enabled && (input.config.development.inspector || input.config.development.liveReload)) {
    const script = devClientScript({
      internalPrefix: input.config.server.internalPrefix,
      token: input.config.development.allowScaffolding ? input.devToken ?? "" : "",
      scenario: input.scenario.id,
      inspector: input.config.development.inspector,
      liveReload: input.config.development.liveReload,
      allowScaffolding: input.config.development.allowScaffolding && Boolean(input.devToken),
      diagnostics,
    });
    $("head").append(`<script data-overlay-bench-dev-client>${escapeClosingTag(script, "script")}</script>`);
  }
  $("html").attr("data-overlay-bench-scenario", input.scenario.id);
  return $.html();
}
