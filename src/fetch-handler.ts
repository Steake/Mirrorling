import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveBenchConfig } from "./config.js";
import { controlDashboard, scenarioSummary } from "./control.js";
import { parseCookieHeader } from "./cookies.js";
import { authorizeHeader, buildHandoffDestination } from "./handoff.js";
import { fetchResponseHeaders } from "./headers.js";
import { transformHtml } from "./html.js";
import { matchesRequest } from "./matcher.js";
import type {
  BenchConfig,
  RawBenchConfig,
  RouteOverride,
  Scenario,
  ScriptOverride,
} from "./types.js";

const SCENARIO_COOKIE = "__overlay_bench_scenario";
const REQUEST_HEADERS_TO_DROP = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-bench-scenario",
]);

export interface FetchBenchHandlerOptions {
  config?: BenchConfig;
  loadConfig?: (request: Request) => Promise<BenchConfig>;
  environment?: NodeJS.ProcessEnv;
  runtime?: "netlify" | "fetch";
}

export type FetchBenchHandler = (request: Request) => Promise<Response>;

function jsonResponse(status: number, value: unknown, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store, private",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function withRuntimeHeader(headers: Headers, runtime: string): Headers {
  headers.set("x-overlay-bench-runtime", runtime);
  return headers;
}

function requestConfig(
  base: BenchConfig,
  request: Request,
  environment: NodeJS.ProcessEnv,
): BenchConfig {
  const publicOrigin = environment.BENCH_PUBLIC_ORIGIN ?? new URL(request.url).origin;
  return {
    ...base,
    server: {
      ...base.server,
      publicOrigin: new URL(publicOrigin).origin,
    },
    upstream: {
      ...base.upstream,
      websocket: false,
    },
    development: {
      enabled: false,
      inspector: false,
      liveReload: false,
      allowScaffolding: false,
    },
  };
}

function selectedScenario(request: Request, config: BenchConfig): Scenario {
  const cookies = parseCookieHeader(request.headers.get("cookie") ?? undefined);
  const requested = request.headers.get("x-bench-scenario") ?? cookies[SCENARIO_COOKIE];
  return config.scenarios.find((scenario) => scenario.id === requested)
    ?? config.scenarios.find((scenario) => scenario.default)
    ?? config.scenarios[0]!;
}

function scenarioSelection(requestUrl: URL, config: BenchConfig, runtime: string): Response | undefined {
  const requested = requestUrl.searchParams.get("__bench_scenario");
  if (!requested) return undefined;
  if (!config.scenarios.some((scenario) => scenario.id === requested)) {
    const response = jsonResponse(400, {
      error: `Unknown scenario: ${requested}`,
      available: config.scenarios.map((scenario) => scenario.id),
    });
    response.headers.set("x-overlay-bench-runtime", runtime);
    return response;
  }
  requestUrl.searchParams.delete("__bench_scenario");
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
      "set-cookie": `${SCENARIO_COOKIE}=${encodeURIComponent(requested)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
      "cache-control": "no-store, private",
      "x-overlay-bench-runtime": runtime,
    },
  });
}

function internalResponse(
  request: Request,
  requestUrl: URL,
  config: BenchConfig,
  scenario: Scenario,
  runtime: string,
): Response | undefined {
  const prefix = config.server.internalPrefix;
  if (requestUrl.pathname !== prefix && !requestUrl.pathname.startsWith(`${prefix}/`)) {
    return undefined;
  }
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET", "x-overlay-bench-runtime": runtime },
    });
  }
  if (requestUrl.pathname === prefix || requestUrl.pathname === `${prefix}/`) {
    return new Response(controlDashboard(config, scenario, "netlify"), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, private",
        "x-overlay-bench-runtime": runtime,
      },
    });
  }
  if (requestUrl.pathname === `${prefix}/health`) {
    return jsonResponse(200, {
      ok: true,
      runtime,
      scenario: scenario.id,
      upstream: config.upstream.origin,
      authoring: false,
      websocketProxy: false,
    }, { "x-overlay-bench-runtime": runtime });
  }
  if (requestUrl.pathname === `${prefix}/config`) {
    return jsonResponse(200, scenarioSummary(config, scenario), {
      "x-overlay-bench-runtime": runtime,
    });
  }
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-overlay-bench-runtime": runtime },
  });
}

function upstreamRequestHeaders(request: Request, config: BenchConfig): Headers {
  const headers = new Headers(request.headers);
  for (const name of REQUEST_HEADERS_TO_DROP) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("x-nf-")) headers.delete(name);
  }
  const stagingOrigin = new URL(config.server.publicOrigin).origin;
  const productionOrigin = new URL(config.upstream.origin).origin;
  if (headers.get("origin") === stagingOrigin) headers.set("origin", productionOrigin);
  const referer = headers.get("referer");
  if (referer?.startsWith(stagingOrigin)) {
    headers.set("referer", referer.replace(stagingOrigin, productionOrigin));
  }
  if (config.server.access.enabled) headers.delete("authorization");
  const cookies = (headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${SCENARIO_COOKIE}=`))
    .join("; ");
  if (cookies) headers.set("cookie", cookies);
  else headers.delete("cookie");
  headers.set("accept-encoding", "identity");
  return headers;
}

async function requestBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (["GET", "HEAD"].includes(request.method.toUpperCase())) return undefined;
  return request.arrayBuffer();
}

async function routeOverrideResponse(rule: RouteOverride, method: string, runtime: string): Promise<Response> {
  if (rule.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
  let body: BodyInit = rule.body ?? "";
  const headers = new Headers(rule.headers);
  headers.set("cache-control", "no-store, private");
  headers.set("x-overlay-bench", "override");
  headers.set("x-overlay-bench-runtime", runtime);
  if (rule.file) body = await readFile(rule.file);
  else if (rule.json !== undefined) {
    body = JSON.stringify(rule.json);
    if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  } else if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8");
  }
  return new Response(method === "HEAD" ? null : body, { status: rule.status, headers });
}

async function localScript(rule: ScriptOverride): Promise<string> {
  if (rule.file) return readFile(rule.file, "utf8");
  return rule.content ?? "";
}

function scriptOverrideOutput(rule: ScriptOverride, production: string, injected: string): string {
  const marker = `\n//# sourceURL=mirrorling://script-overrides/${rule.id}.js\n`;
  if (rule.strategy === "prepend") return `${injected}${marker}\n${production}`;
  if (rule.strategy === "append") return `${production}\n${injected}${marker}`;
  return `${injected}${marker}`;
}

async function proxyResponse(
  request: Request,
  requestUrl: URL,
  config: BenchConfig,
  scenario: Scenario,
  runtime: string,
): Promise<Response> {
  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, config.upstream.origin);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamRequestHeaders(request, config),
      body: await requestBody(request),
      redirect: "manual",
      signal: AbortSignal.timeout(config.upstream.timeoutMs),
    });
  } catch (error) {
    console.error("[mirrorling:fetch] upstream request failed", error);
    return jsonResponse(502, { error: "The production upstream is unavailable." }, {
      "x-overlay-bench-runtime": runtime,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const htmlResponse = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
  const scriptOverride = scenario.scriptOverrides.find((rule) =>
    matchesRequest(rule, requestUrl.pathname, request.method),
  );
  const transformable = request.method !== "HEAD" && ![204, 304].includes(upstream.status);
  const entityHeaders = (): Headers => withRuntimeHeader(
    fetchResponseHeaders(upstream.headers, config, true),
    runtime,
  );

  if ((!htmlResponse && !scriptOverride) || !transformable) {
    return new Response(transformable ? upstream.body : null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: entityHeaders(),
    });
  }

  const declaredLength = Number.parseInt(upstream.headers.get("content-length") ?? "0", 10);
  if (declaredLength > config.html.maxBytes * 2) {
    console.warn(`[mirrorling:fetch] response exceeded the transform limit; passing through ${requestUrl.pathname}`);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: entityHeaders(),
    });
  }

  const original = new Uint8Array(await upstream.arrayBuffer());
  if (original.byteLength > config.html.maxBytes) {
    console.warn(`[mirrorling:fetch] decoded response exceeded the transform limit; passing through ${requestUrl.pathname}`);
    return new Response(original, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: entityHeaders(),
    });
  }

  try {
    let output: string;
    if (htmlResponse) {
      output = await transformHtml({
        html: new TextDecoder().decode(original),
        requestUrl,
        scenario,
        config,
      });
    } else {
      output = scriptOverrideOutput(
        scriptOverride!,
        new TextDecoder().decode(original),
        await localScript(scriptOverride!),
      );
    }
    return new Response(output, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: entityHeaders(),
    });
  } catch (error) {
    console.error(`[mirrorling:fetch] transform failed open for ${requestUrl.pathname}`, error);
    return new Response(original, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: entityHeaders(),
    });
  }
}

async function handleRequest(
  request: Request,
  baseConfig: BenchConfig,
  environment: NodeJS.ProcessEnv,
  runtime: string,
): Promise<Response> {
  const config = requestConfig(baseConfig, request, environment);
  if (!authorizeHeader(request.headers.get("authorization") ?? undefined, config, environment)) {
    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "www-authenticate": 'Basic realm="Mirrorling", charset="UTF-8"',
        "cache-control": "no-store",
        "x-overlay-bench-runtime": runtime,
      },
    });
  }
  const requestUrl = new URL(request.url);
  const selection = scenarioSelection(requestUrl, config, runtime);
  if (selection) return selection;
  const scenario = selectedScenario(request, config);
  const internal = internalResponse(request, requestUrl, config, scenario, runtime);
  if (internal) return internal;
  if (
    config.security.disableServiceWorkers &&
    request.headers.get("sec-fetch-dest") === "serviceworker"
  ) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store", "x-overlay-bench-runtime": runtime },
    });
  }
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return jsonResponse(501, {
      error: "The Netlify runtime supports HTTP proxying only. Use the Node runtime when the production flow requires WebSockets.",
    }, { "x-overlay-bench-runtime": runtime });
  }
  const handoff = scenario.handoffs.find((rule) =>
    matchesRequest(rule, requestUrl.pathname, request.method),
  );
  if (handoff) {
    const destination = buildHandoffDestination(handoff, requestUrl, config);
    if (destination.origin !== new URL(config.upstream.origin).origin) {
      throw new Error("Refusing a handoff outside the configured production origin.");
    }
    return new Response(null, {
      status: handoff.status,
      headers: {
        location: destination.href,
        "cache-control": "no-store, private",
        "x-overlay-bench": "handoff",
        "x-overlay-bench-runtime": runtime,
      },
    });
  }
  const override = scenario.routeOverrides.find((rule) =>
    matchesRequest(rule, requestUrl.pathname, request.method),
  );
  if (override) return routeOverrideResponse(override, request.method, runtime);
  return proxyResponse(request, requestUrl, config, scenario, runtime);
}

export function createFetchBenchHandler(options: FetchBenchHandlerOptions): FetchBenchHandler {
  if (!options.config && !options.loadConfig) {
    throw new Error("createFetchBenchHandler requires config or loadConfig.");
  }
  const environment = options.environment ?? process.env;
  const runtime = options.runtime ?? "fetch";
  return async (request) => {
    try {
      const config = options.config ?? await options.loadConfig!(request);
      return await handleRequest(request, config, environment, runtime);
    } catch (error) {
      console.error("[mirrorling:fetch] configuration or request failure", error);
      return jsonResponse(503, {
        error: "Mirrorling is not correctly configured for this deployment.",
      }, { "x-overlay-bench-runtime": runtime });
    }
  };
}

export function createNetlifyConfigLoader(
  environment: NodeJS.ProcessEnv = process.env,
  bundledConfig?: RawBenchConfig,
): (request: Request) => Promise<BenchConfig> {
  const configuredPath = environment.BENCH_CONFIG_PATH;
  const configPath = resolve(configuredPath ?? "bench.config.json");
  let rawPromise: Promise<RawBenchConfig | undefined> | undefined;
  const loadRaw = (): Promise<RawBenchConfig | undefined> => {
    rawPromise ??= !configuredPath && bundledConfig
      ? Promise.resolve(bundledConfig)
      : readFile(configPath, "utf8")
        .then((contents) => JSON.parse(contents) as RawBenchConfig)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" && !configuredPath) return undefined;
          throw error;
        });
    return rawPromise;
  };
  return async (request) => {
    const raw = await loadRaw();
    if (!raw?.upstream?.origin && !environment.BENCH_UPSTREAM_ORIGIN) {
      throw new Error("Set BENCH_UPSTREAM_ORIGIN or commit bench.config.json before deploying.");
    }
    const requestEnvironment: NodeJS.ProcessEnv = {
      ...environment,
      BENCH_PUBLIC_ORIGIN: environment.BENCH_PUBLIC_ORIGIN ?? new URL(request.url).origin,
      BENCH_DEV_MODE: "0",
    };
    const config = resolveBenchConfig(raw ?? {}, dirname(configPath), requestEnvironment);
    config.configPath = configPath;
    config.development = {
      enabled: false,
      inspector: false,
      liveReload: false,
      allowScaffolding: false,
    };
    config.upstream.websocket = false;
    return config;
  };
}
