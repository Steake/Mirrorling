import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";
import httpProxy from "http-proxy";
import { loadBenchConfig } from "./config.js";
import { controlDashboard, scenarioSummary } from "./control.js";
import { parseCookieHeader } from "./cookies.js";
import { scaffoldProject, type ScaffoldRequest } from "./dev-project.js";
import { authorizeRequest, buildHandoffLocation } from "./handoff.js";
import { responseHeaders } from "./headers.js";
import { transformHtml } from "./html.js";
import { matchesRequest } from "./matcher.js";
import { sendOverride } from "./overrides.js";
import type {
  BenchConfig,
  BenchInstance,
  BenchRequestContext,
  Scenario,
  ScriptOverride,
} from "./types.js";

const unzipGzip = promisify(gunzip);
const unzipDeflate = promisify(inflate);
const unzipBrotli = promisify(brotliDecompress);
const SCENARIO_COOKIE = "__overlay_bench_scenario";

export interface BenchLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const DEFAULT_LOGGER: BenchLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function upstreamCookieHeader(request: IncomingMessage): string {
  return (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${SCENARIO_COOKIE}=`))
    .join("; ");
}

function adaptUpstreamRequest(
  proxyRequest: ClientRequest,
  request: IncomingMessage,
  config: BenchConfig,
): void {
  const stagingOrigin = new URL(config.server.publicOrigin).origin;
  const productionOrigin = new URL(config.upstream.origin).origin;
  if (request.headers.origin === stagingOrigin) {
    proxyRequest.setHeader("origin", productionOrigin);
  }
  const referer = request.headers.referer;
  if (referer?.startsWith(stagingOrigin)) {
    proxyRequest.setHeader("referer", referer.replace(stagingOrigin, productionOrigin));
  }
  proxyRequest.removeHeader("x-bench-scenario");
  if (config.server.access.enabled) proxyRequest.removeHeader("authorization");
  const cookies = upstreamCookieHeader(request);
  if (cookies) proxyRequest.setHeader("cookie", cookies);
  else proxyRequest.removeHeader("cookie");
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store, private",
  });
  response.end(body);
}

function selectedScenario(request: IncomingMessage, config: BenchConfig): Scenario {
  const fromHeader = request.headers["x-bench-scenario"];
  const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const cookies = parseCookieHeader(request.headers.cookie);
  const requested = headerValue ?? cookies[SCENARIO_COOKIE];
  return config.scenarios.find((scenario) => scenario.id === requested)
    ?? config.scenarios.find((scenario) => scenario.default)
    ?? config.scenarios[0]!;
}

function maybeSelectScenario(requestUrl: URL, response: ServerResponse, config: BenchConfig): boolean {
  const requested = requestUrl.searchParams.get("__bench_scenario");
  if (!requested) return false;
  if (!config.scenarios.some((scenario) => scenario.id === requested)) {
    writeJson(response, 400, { error: `Unknown scenario: ${requested}`, available: config.scenarios.map((scenario) => scenario.id) });
    return true;
  }
  requestUrl.searchParams.delete("__bench_scenario");
  const secure = new URL(config.server.publicOrigin).protocol === "https:" ? "; Secure" : "";
  response.writeHead(302, {
    location: `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
    "set-cookie": `${SCENARIO_COOKIE}=${encodeURIComponent(requested)}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    "cache-control": "no-store, private",
  });
  response.end();
  return true;
}

async function readJsonRequest(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) throw new Error(`Request body exceeds ${limit} bytes.`);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function replaceConfig(current: BenchConfig, next: BenchConfig): { restartRequired: string[] } {
  const restartRequired: string[] = [];
  if (current.server.host !== next.server.host) restartRequired.push("server.host");
  if (current.server.port !== next.server.port) restartRequired.push("server.port");
  Object.assign(current, next);
  return { restartRequired };
}

async function internalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  scenario: Scenario,
  config: BenchConfig,
  devToken: string,
  eventClients: Set<ServerResponse>,
): Promise<boolean> {
  const prefix = config.server.internalPrefix;
  if (requestUrl.pathname !== prefix && !requestUrl.pathname.startsWith(`${prefix}/`)) return false;

  if (request.method === "GET" && requestUrl.pathname === `${prefix}/events`) {
    if (!config.development.enabled || !config.development.liveReload) {
      response.writeHead(404); response.end(); return true;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write(": overlay-bench live reload\n\n");
    eventClients.add(response);
    request.once("close", () => eventClients.delete(response));
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === `${prefix}/api/scaffold`) {
    if (!config.development.enabled || !config.development.allowScaffolding) {
      writeJson(response, 403, { error: "Scaffolding is disabled." }); return true;
    }
    const suppliedToken = request.headers["x-bench-dev-token"];
    if (suppliedToken !== devToken || request.headers.origin !== new URL(config.server.publicOrigin).origin) {
      writeJson(response, 403, { error: "Invalid development authoring token or origin." }); return true;
    }
    try {
      const payload = await readJsonRequest(request, 2_700_000) as ScaffoldRequest;
      if (!payload || !["element-override", "injected-script", "script-override"].includes(payload.kind)) {
        throw new Error("Unknown scaffold kind.");
      }
      const result = await scaffoldProject(config, payload);
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        BENCH_DEV_MODE: "1",
        BENCH_PUBLIC_ORIGIN: config.server.publicOrigin,
        BENCH_UPSTREAM_ORIGIN: config.upstream.origin,
      };
      const next = await loadBenchConfig(config.configPath, environment);
      replaceConfig(config, next);
      writeJson(response, 201, result);
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET, POST" }); response.end(); return true;
  }
  if (requestUrl.pathname === prefix || requestUrl.pathname === `${prefix}/`) {
    const body = controlDashboard(config, scenario);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(body)), "cache-control": "no-store, private" });
    response.end(body); return true;
  }
  if (requestUrl.pathname === `${prefix}/health`) {
    writeJson(response, 200, { ok: true, scenario: scenario.id, upstream: config.upstream.origin, development: config.development.enabled }); return true;
  }
  if (requestUrl.pathname === `${prefix}/config`) {
    writeJson(response, 200, scenarioSummary(config, scenario));
    return true;
  }
  response.writeHead(404); response.end(); return true;
}

function writeProxyHeaders(
  response: ServerResponse,
  statusCode: number,
  statusMessage: string | undefined,
  headers: Record<string, string | string[]>,
): void {
  response.writeHead(statusCode, statusMessage, headers);
}

async function decompressBody(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  switch (encoding?.toLowerCase()) {
    case "gzip": return unzipGzip(body);
    case "deflate": return unzipDeflate(body);
    case "br": return unzipBrotli(body);
    case undefined:
    case "identity":
    case "": return body;
    default: throw new Error(`Unsupported content encoding: ${encoding}`);
  }
}

function isHtmlResponse(proxyResponse: IncomingMessage): boolean {
  const contentType = proxyResponse.headers["content-type"] ?? "";
  return /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
}

async function collectOrPassThrough(
  proxyResponse: IncomingMessage,
  response: ServerResponse,
  config: BenchConfig,
  statusCode: number,
  limit: number,
  logger: BenchLogger,
  label: string,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  let streamed = false;
  proxyResponse.on("data", (chunk: Buffer) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (streamed) { response.write(buffer); return; }
    total += buffer.byteLength;
    if (total > limit) {
      streamed = true;
      writeProxyHeaders(response, statusCode, proxyResponse.statusMessage, responseHeaders(proxyResponse.headers, config, false));
      for (const buffered of chunks) response.write(buffered);
      chunks.length = 0;
      response.write(buffer);
      logger.warn(`[mirrorling] ${label} exceeded ${limit} compressed bytes; passed through unchanged.`);
      return;
    }
    chunks.push(buffer);
  });
  await new Promise<void>((resolve, reject) => {
    proxyResponse.once("end", resolve);
    proxyResponse.once("error", reject);
  });
  if (streamed) { response.end(); return undefined; }
  return Buffer.concat(chunks);
}

async function localScript(rule: ScriptOverride): Promise<string> {
  if (rule.file) return readFile(rule.file, "utf8");
  return rule.content ?? "";
}

async function transformedProxyResponse(
  proxyResponse: IncomingMessage,
  request: IncomingMessage,
  response: ServerResponse,
  context: BenchRequestContext,
  config: BenchConfig,
  logger: BenchLogger,
  devToken: string,
): Promise<void> {
  const statusCode = proxyResponse.statusCode ?? 502;
  const htmlResponse = isHtmlResponse(proxyResponse);
  const scriptOverride = context.scenario.scriptOverrides.find((rule) =>
    matchesRequest(rule, context.requestUrl.pathname, request.method),
  );
  const transformable = request.method !== "HEAD" && ![204, 304].includes(statusCode);
  if ((!htmlResponse && !scriptOverride) || !transformable) {
    writeProxyHeaders(response, statusCode, proxyResponse.statusMessage, responseHeaders(proxyResponse.headers, config, false));
    proxyResponse.pipe(response);
    return;
  }

  const original = await collectOrPassThrough(
    proxyResponse,
    response,
    config,
    statusCode,
    config.html.maxBytes * 2,
    logger,
    htmlResponse ? "HTML response" : `Script override ${scriptOverride?.id ?? ""}`,
  );
  if (!original) return;

  try {
    const decoded = await decompressBody(original, proxyResponse.headers["content-encoding"] as string | undefined);
    if (decoded.byteLength > config.html.maxBytes) {
      writeProxyHeaders(response, statusCode, proxyResponse.statusMessage, responseHeaders(proxyResponse.headers, config, false));
      response.end(original);
      logger.warn(`[mirrorling] ${htmlResponse ? "HTML" : "Script"} response exceeded ${config.html.maxBytes} decoded bytes; passed through unchanged.`);
      return;
    }

    let outputText: string;
    if (htmlResponse) {
      outputText = await transformHtml({
        html: decoded.toString("utf8"),
        requestUrl: context.requestUrl,
        scenario: context.scenario,
        config,
        devToken: config.development.enabled ? devToken : undefined,
      });
    } else {
      const production = decoded.toString("utf8");
      const injected = await localScript(scriptOverride!);
      const marker = `\n//# sourceURL=mirrorling://script-overrides/${scriptOverride!.id}.js\n`;
      if (scriptOverride!.strategy === "prepend") outputText = `${injected}${marker}\n${production}`;
      else if (scriptOverride!.strategy === "append") outputText = `${production}\n${injected}${marker}`;
      else outputText = `${injected}${marker}`;
    }
    const output = Buffer.from(outputText, "utf8");
    const headers = responseHeaders(proxyResponse.headers, config, true);
    headers["content-length"] = String(output.byteLength);
    writeProxyHeaders(response, statusCode, proxyResponse.statusMessage, headers);
    response.end(output);
  } catch (error) {
    logger.error(`[mirrorling] ${htmlResponse ? "HTML transformation" : `Script override ${scriptOverride?.id}`} failed open: ${error instanceof Error ? error.message : String(error)}`);
    if (!response.headersSent) {
      writeProxyHeaders(response, statusCode, proxyResponse.statusMessage, responseHeaders(proxyResponse.headers, config, false));
      response.end(original);
    } else response.destroy(error instanceof Error ? error : undefined);
  }
}

export function createBench(config: BenchConfig, logger: BenchLogger = DEFAULT_LOGGER): BenchInstance {
  const contexts = new WeakMap<IncomingMessage, BenchRequestContext>();
  const eventClients = new Set<ServerResponse>();
  const devToken = randomBytes(24).toString("base64url");
  const proxy = httpProxy.createProxyServer({ changeOrigin: true, selfHandleResponse: true });

  proxy.on("proxyReq", (proxyRequest, request) => {
    adaptUpstreamRequest(proxyRequest, request, config);
  });
  proxy.on("proxyReqWs", (proxyRequest, request) => {
    adaptUpstreamRequest(proxyRequest, request, config);
  });
  proxy.on("proxyRes", (proxyResponse, request, response) => {
    const context = contexts.get(request);
    if (!context) { response.writeHead(500); response.end("Missing Mirrorling request context."); return; }
    void transformedProxyResponse(proxyResponse, request, response, context, config, logger, devToken).catch((error) => {
      logger.error(`[mirrorling] Proxy response failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) { response.writeHead(502); response.end("The production overlay failed while processing the upstream response."); }
      else response.destroy(error instanceof Error ? error : undefined);
    });
  });
  proxy.on("error", (error, _request, response) => {
    logger.error(`[mirrorling] Upstream proxy error: ${error.message}`);
    if (response && "writeHead" in response && !response.headersSent) { response.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); response.end("The production upstream is unavailable."); }
  });

  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        if (!authorizeRequest(request, config)) {
          response.writeHead(401, { "www-authenticate": 'Basic realm="Mirrorling", charset="UTF-8"', "cache-control": "no-store" }); response.end("Authentication required."); return;
        }
        const requestUrl = new URL(request.url ?? "/", config.server.publicOrigin);
        if (maybeSelectScenario(requestUrl, response, config)) return;
        const scenario = selectedScenario(request, config);
        if (await internalRequest(request, response, requestUrl, scenario, config, devToken, eventClients)) return;
        if (config.security.disableServiceWorkers && request.headers["sec-fetch-dest"] === "serviceworker") { response.writeHead(404, { "cache-control": "no-store" }); response.end(); return; }

        const handoff = scenario.handoffs.find((rule) => matchesRequest(rule, requestUrl.pathname, request.method));
        if (handoff) {
          const destination = buildHandoffLocation({ rule: handoff, request, requestUrl, scenario, config });
          response.writeHead(handoff.status, { location: destination.href, "cache-control": "no-store, private", "x-overlay-bench": "handoff" }); response.end(); return;
        }
        const override = scenario.routeOverrides.find((rule) => matchesRequest(rule, requestUrl.pathname, request.method));
        if (override) { await sendOverride(override, response); return; }

        const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, config.upstream.origin);
        contexts.set(request, { requestUrl, upstreamUrl, scenario });
        proxy.web(request, response, {
          target: config.upstream.origin,
          secure: config.upstream.rejectUnauthorized,
          proxyTimeout: config.upstream.timeoutMs,
          timeout: config.upstream.timeoutMs,
        });
      } catch (error) {
        logger.error(`[mirrorling] Request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) writeJson(response, 500, { error: "Mirrorling could not process this request." });
        else response.destroy(error instanceof Error ? error : undefined);
      }
    })();
  });
  server.on("upgrade", (request, socket, head) => {
    try {
      if (!config.upstream.websocket) {
        rejectUpgrade(socket, 426, "Upgrade Required");
        return;
      }
      if (!authorizeRequest(request, config)) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      proxy.ws(request, socket, head, {
        target: config.upstream.origin,
        secure: config.upstream.rejectUnauthorized,
      });
    } catch (error) {
      logger.error(`[mirrorling] WebSocket upgrade failed: ${error instanceof Error ? error.message : String(error)}`);
      rejectUpgrade(socket, 500, "Internal Server Error");
    }
  });
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); });

  let listeningOrigin = config.server.publicOrigin;
  return {
    get origin() { return listeningOrigin; },
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.server.port, config.server.host, () => {
          server.off("error", reject);
          const address = server.address() as AddressInfo;
          if (config.server.port === 0) {
            const configured = new URL(config.server.publicOrigin);
            configured.port = String(address.port);
            config.server.publicOrigin = configured.origin;
            listeningOrigin = configured.origin;
          }
          logger.info(`[mirrorling] Listening on ${listeningOrigin} → ${config.upstream.origin}`);
          resolve();
        });
      });
    },
    reload(next) {
      const result = replaceConfig(config, next);
      if (!result.restartRequired.includes("server.host") && !result.restartRequired.includes("server.port")) listeningOrigin = config.server.publicOrigin;
      return result;
    },
    notifyReload(reason = "files changed") {
      const payload = JSON.stringify({ reason, at: Date.now() });
      for (const client of eventClients) client.write(`event: reload\ndata: ${payload}\n\n`);
    },
    async close() {
      for (const client of eventClients) client.end();
      eventClients.clear();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      proxy.close();
    },
  };
}
