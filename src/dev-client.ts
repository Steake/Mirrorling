import type { TransformDiagnostic } from "./types.js";

export interface DevClientSettings {
  internalPrefix: string;
  token: string;
  scenario: string;
  inspector: boolean;
  liveReload: boolean;
  allowScaffolding: boolean;
  diagnostics: TransformDiagnostic[];
}

export function devClientScript(settings: DevClientSettings): string {
  const serialized = JSON.stringify(settings).replaceAll("<", "\\u003c");
  return `(() => {
  "use strict";
  const settings = ${serialized};

  if (settings.liveReload && typeof EventSource !== "undefined") {
    const events = new EventSource(settings.internalPrefix + "/events");
    events.addEventListener("reload", () => location.reload());
  }
  if (!settings.inspector || document.getElementById("__overlay_bench_devtools")) return;

  const host = document.createElement("div");
  host.id = "__overlay_bench_devtools";
  host.setAttribute("data-overlay-bench-devtools", "");
  const shadow = host.attachShadow({ mode: "open" });
  const css = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".shell{position:fixed;z-index:2147483647;right:14px;bottom:14px;width:min(420px,calc(100vw - 28px));font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#f7f8fa;pointer-events:auto}",
    ".bar,.panel{background:#11151b;border:1px solid #343c49;box-shadow:0 16px 54px #0009}",
    ".bar{display:flex;align-items:center;gap:7px;padding:9px;border-radius:13px}",
    ".brand{font-weight:850;margin-right:auto;letter-spacing:-.01em}.brand span{color:#70e1b2}",
    "button{appearance:none;border:1px solid #424c5c;border-radius:8px;background:#202630;color:#f7f8fa;padding:6px 9px;font:inherit;font-weight:700;cursor:pointer}",
    "button:hover{border-color:#70e1b2}button.on{background:#70e1b2;color:#08110d;border-color:#70e1b2}",
    "button.primary{background:#70e1b2;color:#08110d;border-color:#70e1b2}button:disabled{opacity:.45;cursor:not-allowed}",
    ".badge{min-width:20px;text-align:center;border-radius:99px;background:#e7a94b;color:#171006;padding:2px 6px;font-weight:900}",
    ".panel{display:none;margin-bottom:8px;max-height:min(570px,72vh);overflow:auto;border-radius:13px;padding:13px}.panel.open{display:block}",
    ".muted{color:#aeb7c4}.risk{color:#ffc76d}.ok{color:#70e1b2}.error{color:#ff8c8c}",
    "h3{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:#98a3b2;margin:14px 0 7px}h3:first-child{margin-top:0}",
    ".target{background:#0b0e13;border:1px solid #2a313d;border-radius:9px;padding:9px;word-break:break-word}",
    ".candidate{display:grid;grid-template-columns:1fr auto;gap:7px;margin:6px 0}.candidate button:first-child{text-align:left;font:12px/1.35 ui-monospace,SFMono-Regular,monospace;overflow:hidden;text-overflow:ellipsis}",
    ".actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}",
    ".diagnostic{border-left:3px solid #e7a94b;padding:5px 8px;margin:6px 0;background:#191d24}.diagnostic.error{border-color:#ff7373}",
    ".script{display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;padding:7px 0;border-bottom:1px solid #2a313d}.script code{overflow:hidden;text-overflow:ellipsis;white-space:normal;color:#bdc7d5}.script small,.candidate small{color:#8f9baa;font:11px/1.3 ui-sans-serif,system-ui,sans-serif}",
    ".status{margin-top:8px;min-height:18px;color:#aeb7c4}",
    ".highlight{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #70e1b2;background:#70e1b21c;display:none}",
    "@media(max-width:520px){.shell{right:7px;bottom:7px;width:calc(100vw - 14px)}}"
  ].join("");
  shadow.innerHTML = '<style>' + css + '</style>' +
    '<div class="highlight"></div><div class="shell"><section class="panel"></section><nav class="bar">' +
    '<div class="brand"><span>Mirror</span>ling</div><button data-action="panel">Tools</button>' +
    '<button data-action="inspect">Inspect</button><span class="badge" title="transform diagnostics">' + settings.diagnostics.length + '</span></nav></div>';

  const panel = shadow.querySelector(".panel");
  const highlight = shadow.querySelector(".highlight");
  const inspectButton = shadow.querySelector('[data-action="inspect"]');
  const panelButton = shadow.querySelector('[data-action="panel"]');
  let inspecting = false;
  let selected = null;
  let candidates = [];

  const esc = (value) => window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  const safeCount = (selector) => {
    try { return document.querySelectorAll(selector).length; } catch { return 0; }
  };
  const stableClass = (name) => name.length < 42 && !/[a-f0-9]{8,}/i.test(name) && !/\\d{4,}/.test(name);
  const addCandidate = (items, selector, reason, score) => {
    if (!selector || items.some((item) => item.selector === selector)) return;
    items.push({ selector, reason, score, count: safeCount(selector) });
  };
  const selectorCandidates = (element) => {
    const items = [];
    const tag = element.localName;
    if (element.id) addCandidate(items, "#" + esc(element.id), "unique id", 100);
    for (const name of ["data-testid", "data-test", "data-qa", "data-component", "data-cy"]) {
      const value = element.getAttribute(name);
      if (value) addCandidate(items, '[' + name + '=\"' + esc(value) + '\"]', name, 96);
    }
    for (const name of ["name", "aria-label", "role"]) {
      const value = element.getAttribute(name);
      if (value) addCandidate(items, tag + '[' + name + '=\"' + esc(value) + '\"]', name, 84);
    }
    const classes = [...element.classList].filter(stableClass).slice(0, 3);
    if (classes.length) addCandidate(items, tag + classes.map((name) => "." + esc(name)).join(""), "stable classes", 72);
    let current = element;
    const parts = [];
    while (current && current.nodeType === 1 && parts.length < 5 && current !== document.documentElement) {
      let part = current.localName;
      if (current.id) { part = "#" + esc(current.id); parts.unshift(part); break; }
      const siblings = current.parentElement ? [...current.parentElement.children].filter((node) => node.localName === current.localName) : [];
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      parts.unshift(part);
      current = current.parentElement;
    }
    addCandidate(items, parts.join(" > "), "structural fallback", 35);
    return items.sort((a, b) => (b.count === 1 ? b.score + 30 : b.score) - (a.count === 1 ? a.score + 30 : a.score));
  };
  const frameworkRisk = (element) => {
    const root = element.closest("#__next,#root,[data-reactroot],[data-v-app],[ng-version]");
    const keys = Object.keys(element);
    if (root || keys.some((key) => key.startsWith("__react") || key.startsWith("__vue"))) {
      return "Hydration risk: this sits inside a framework-managed root. Prefer replacing a stable boundary, or use injected JS after DOM ready.";
    }
    return "No obvious framework hydration root detected.";
  };
  const html = (value) => String(value).replace(/[&<>\"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"})[character]);
  const setStatus = (message, kind) => {
    const target = panel.querySelector(".status");
    if (target) { target.textContent = message; target.className = "status " + (kind || ""); }
  };
  const copyText = async (value) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  };
  const postScaffold = async (payload) => {
    setStatus("Writing scaffold…");
    const response = await fetch(settings.internalPrefix + "/api/scaffold", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bench-dev-token": settings.token },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Scaffold request failed");
    setStatus("Created " + result.files.join(", ") + ". Reloading into " + result.scenario + "…", "ok");
    const next = new URL(location.href);
    next.searchParams.set("__bench_scenario", result.scenario);
    setTimeout(() => location.assign(next.href), 250);
  };
  const diagnosticsMarkup = () => settings.diagnostics.length
    ? settings.diagnostics.map((item) => '<div class="diagnostic ' + item.level + '"><strong>' + html(item.id) + '</strong><br>' + html(item.message) + '</div>').join("")
    : '<p class="muted">No transform warnings on this response.</p>';
  const scriptsMarkup = () => [...document.scripts]
    .filter((script) => script.src && !script.hasAttribute("data-overlay-bench-runtime") && !script.hasAttribute("data-overlay-bench-dev-client"))
    .map((script, index) => {
      const traits = [script.type || "classic", script.async ? "async" : "", script.defer ? "defer" : "", script.integrity ? "SRI" : ""].filter(Boolean).join(" · ");
      return '<div class="script"><code title="' + html(script.src) + '">' + html(new URL(script.src).pathname) + '<br><small>' + html(traits) + '</small></code><button data-script-index="' + index + '" ' + (!settings.allowScaffolding ? 'disabled' : '') + '>Override</button></div>';
    })
    .join("") || '<p class="muted">No external scripts on this page.</p>';
  const render = () => {
    const targetMarkup = selected
      ? '<h3>Selected element</h3><div class="target"><strong>' + html(selected.localName) + '</strong> · ' + Math.round(selected.getBoundingClientRect().width) + '×' + Math.round(selected.getBoundingClientRect().height) + 'px<br><span class="muted">display: ' + html(getComputedStyle(selected).display) + ' · position: ' + html(getComputedStyle(selected).position) + ' · font: ' + html(getComputedStyle(selected).fontFamily) + '</span><br><span class="' + (frameworkRisk(selected).startsWith("Hydration") ? "risk" : "ok") + '">' + html(frameworkRisk(selected)) + '</span></div>' +
        '<h3>Selector candidates</h3>' + candidates.map((item, index) => '<div class="candidate"><button title="Copy selector" data-selector-index="' + index + '">' + html(item.selector) + '<br><small>' + html(item.reason) + '</small></button><span class="muted">' + item.count + ' match' + (item.count === 1 ? '' : 'es') + '</span></div>').join("") +
        '<div class="actions"><button class="primary" data-action="element" ' + (!settings.allowScaffolding ? 'disabled' : '') + '>Scaffold element</button></div>'
      : '<h3>Page intel</h3><p class="muted">Turn on Inspect, then click a production element. Mirrorling ranks selectors, counts matches, and flags hydration risk.</p>';
    panel.innerHTML = targetMarkup +
      '<h3>Independent injected code</h3><div class="actions"><button data-action="inject" ' + (!settings.allowScaffolding ? 'disabled' : '') + '>New injected JS</button></div>' +
      '<h3>Production scripts</h3>' + scriptsMarkup() +
      '<h3>Diagnostics</h3>' + diagnosticsMarkup() + '<div class="status"></div>';
  };
  const select = (element) => {
    selected = element;
    candidates = selectorCandidates(element);
    panel.classList.add("open");
    render();
  };
  const placeHighlight = (element) => {
    if (!element) { highlight.style.display = "none"; return; }
    const box = element.getBoundingClientRect();
    Object.assign(highlight.style, { display:"block", left:box.left + "px", top:box.top + "px", width:box.width + "px", height:box.height + "px" });
  };
  const stopInspect = () => {
    inspecting = false;
    inspectButton.classList.remove("on");
    highlight.style.display = "none";
  };

  panelButton.addEventListener("click", () => { panel.classList.toggle("open"); render(); });
  inspectButton.addEventListener("click", () => {
    inspecting = !inspecting;
    inspectButton.classList.toggle("on", inspecting);
    inspectButton.textContent = inspecting ? "Pick element" : "Inspect";
    if (!inspecting) highlight.style.display = "none";
  });
  document.addEventListener("pointermove", (event) => {
    if (!inspecting || !(event.target instanceof Element) || event.target === host || host.contains(event.target)) return;
    placeHighlight(event.target);
  }, true);
  document.addEventListener("click", (event) => {
    if (!inspecting || !(event.target instanceof Element) || event.target === host || host.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    select(event.target); stopInspect(); inspectButton.textContent = "Inspect";
  }, true);
  panel.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    try {
      if (button.dataset.selectorIndex) {
        const item = candidates[Number(button.dataset.selectorIndex)];
        await copyText(item.selector);
        setStatus("Selector copied: " + item.selector, "ok");
      } else if (button.dataset.action === "element" && selected) {
        const best = candidates[0];
        await postScaffold({ kind:"element-override", selector:best.selector, expectedCount:best.count, tag:selected.localName, outerHTML:selected.outerHTML, pagePath:location.pathname, scenario:settings.scenario });
      } else if (button.dataset.action === "inject") {
        const name = prompt("Name this independent injection", "page-experiment");
        if (name) await postScaffold({ kind:"injected-script", name, pagePath:location.pathname, scenario:settings.scenario });
      } else if (button.dataset.scriptIndex !== undefined) {
        const scripts = [...document.scripts].filter((script) => script.src && !script.hasAttribute("data-overlay-bench-runtime") && !script.hasAttribute("data-overlay-bench-dev-client"));
        const script = scripts[Number(button.dataset.scriptIndex)];
        if (!script) throw new Error("That script is no longer present");
        setStatus("Reading the production script…");
        const source = await fetch(script.src).then((response) => { if (!response.ok) throw new Error("Could not read script"); return response.text(); });
        await postScaffold({ kind:"script-override", scriptUrl:script.src, source, pagePath:location.pathname, scenario:settings.scenario });
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error), "error"); }
  });

  document.documentElement.appendChild(host);
  render();
})();`;
}
