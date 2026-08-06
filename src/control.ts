import type { BenchConfig, Scenario } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function scenarioSummary(config: BenchConfig, active: Scenario): Record<string, unknown> {
  return {
    scenario: active.id,
    scenarios: config.scenarios.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      elementOverrides: candidate.elementOverrides.reduce(
        (total, rule) => total + rule.operations.length,
        0,
      ),
      injectedScripts: candidate.injectedScripts.length,
      injectedStyles: candidate.injectedStyles.length,
      scriptOverrides: candidate.scriptOverrides.length,
      routeOverrides: candidate.routeOverrides.length,
      handoffs: candidate.handoffs.map((handoff) => ({
        id: handoff.id,
        destination: handoff.destination,
        transport: handoff.clientState.transport,
      })),
    })),
    productionOrigin: config.upstream.origin,
    development: config.development,
  };
}

export function controlDashboard(
  config: BenchConfig,
  active: Scenario,
  runtime: "node" | "netlify" = "node",
): string {
  const cards = config.scenarios
    .map(
      (scenario) => `<li class="scenario${scenario.id === active.id ? " active" : ""}">
  <div><strong>${escapeHtml(scenario.title)}</strong><code>${escapeHtml(scenario.id)}</code></div>
  <p>${escapeHtml(scenario.description)}</p>
  <small>${scenario.elementOverrides.length} element rule(s) · ${scenario.injectedScripts.length} injected script(s) · ${scenario.scriptOverrides.length} production script override(s)</small><br>
  <a href="/?__bench_scenario=${encodeURIComponent(scenario.id)}">Open scenario</a>
</li>`,
    )
    .join("\n");
  const runtimeNote = runtime === "netlify"
    ? "Netlify HTTP runtime · author locally with npm run dev"
    : `Node runtime · Dev tools: ${config.development.enabled ? "on" : "off"}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mirrorling</title><style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#0b0d12;color:#f3f5f7}body{max-width:880px;margin:0 auto;padding:48px 24px}h1{margin:0 0 8px;font-size:clamp(2rem,5vw,3.5rem);letter-spacing:-.04em}.meta,small{color:#9da7b3}ul{list-style:none;padding:0;display:grid;gap:12px}.scenario{border:1px solid #2a303a;background:#12161d;border-radius:14px;padding:18px}.scenario.active{border-color:#65d0a5;box-shadow:0 0 0 1px #65d0a544}.scenario div{display:flex;justify-content:space-between;gap:16px}code{color:#9da7b3}p{color:#bdc5ce}a{color:#08100d;background:#65d0a5;border-radius:999px;display:inline-block;margin-top:13px;padding:8px 14px;text-decoration:none;font-weight:700}
</style></head><body><h1>Mirrorling</h1><p class="meta">The production site, under temporary management.</p><p class="meta">Upstream: ${escapeHtml(config.upstream.origin)} · Active: ${escapeHtml(active.id)} · ${escapeHtml(runtimeNote)}</p><ul>${cards}</ul></body></html>`;
}
