import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  BenchConfig,
  ElementOverrideRule,
  HandoffRule,
  HtmlOperation,
  InjectedScript,
  InjectedStyle,
  LegacyHtmlRule,
  RawBenchConfig,
  RawScenario,
  RouteOverride,
  Scenario,
  ScriptOverride,
} from "./types.js";

const DEFAULT_SCENARIO: Scenario = {
  id: "default",
  title: "Default overlay",
  description: "Production passthrough with the global Mirrorling runtime.",
  default: true,
  vars: {},
  elementOverrides: [],
  injectedScripts: [],
  injectedStyles: [],
  scriptOverrides: [],
  routeOverrides: [],
  handoffs: [],
};

function configuredFile(configDirectory: string, path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  return isAbsolute(path) ? path : resolve(configDirectory, path);
}

function normalizeOperation(
  operation: HtmlOperation,
  configDirectory: string,
): HtmlOperation {
  return {
    ...operation,
    file: configuredFile(configDirectory, operation.file),
  };
}

function normalizeInjectedScript(
  script: Partial<InjectedScript> & Pick<InjectedScript, "id">,
  configDirectory: string,
): InjectedScript {
  return {
    ...script,
    match: script.match ?? "/**",
    file: configuredFile(configDirectory, script.file),
    timing: script.timing ?? "body-end",
    module: script.module ?? false,
  };
}

function normalizeInjectedStyle(
  style: Partial<InjectedStyle> & Pick<InjectedStyle, "id">,
  configDirectory: string,
): InjectedStyle {
  return {
    ...style,
    match: style.match ?? "/**",
    file: configuredFile(configDirectory, style.file),
  };
}

function normalizeElementRule(
  rule: Partial<ElementOverrideRule>,
  configDirectory: string,
): ElementOverrideRule {
  return {
    match: rule.match ?? "/**",
    methods: rule.methods,
    operations: (rule.operations ?? []).map((operation) =>
      normalizeOperation(operation, configDirectory),
    ),
  };
}

function normalizeScriptOverride(
  rule: Partial<ScriptOverride> & Pick<ScriptOverride, "id">,
  configDirectory: string,
): ScriptOverride {
  return {
    ...rule,
    match: rule.match ?? "/**",
    strategy: rule.strategy ?? "replace",
    file: configuredFile(configDirectory, rule.file),
  };
}

function normalizeOverride(
  rule: RouteOverride,
  configDirectory: string,
): RouteOverride {
  return {
    match: rule.match ?? "/**",
    methods: rule.methods,
    status: rule.status ?? 200,
    headers: rule.headers ?? {},
    body: rule.body,
    file: configuredFile(configDirectory, rule.file),
    json: rule.json,
    delayMs: rule.delayMs ?? 0,
  };
}

function normalizeHandoff(rule: HandoffRule): HandoffRule {
  return {
    id: rule.id,
    match: rule.match ?? "/**",
    methods: rule.methods,
    destination: rule.destination ?? "/",
    preservePath: rule.preservePath ?? false,
    preserveQuery: rule.preserveQuery ?? false,
    status: rule.status ?? 302,
    carryQuery: rule.carryQuery ?? [],
    clientState: {
      transport: rule.clientState?.transport ?? "none",
      parameter: rule.clientState?.parameter ?? "bench_state",
      stateKeys: rule.clientState?.stateKeys ?? [],
    },
  };
}

function normalizeScenario(input: RawScenario, configDirectory: string): Scenario {
  const legacyRules = input.htmlRules ?? [];
  const legacyScripts = legacyRules.flatMap((rule, ruleIndex) =>
    (rule.scripts ?? []).map((script, scriptIndex) => ({
      id: script.id ?? `legacy-script-${ruleIndex + 1}-${scriptIndex + 1}`,
      match: rule.match ?? "/**",
      methods: rule.methods,
      file: script.file,
      content: script.content,
      module: script.module,
      timing: script.location === "head" ? "head-end" as const : "body-end" as const,
    })),
  );
  const legacyStyles = legacyRules.flatMap((rule, ruleIndex) =>
    (rule.styles ?? []).map((style, styleIndex) => ({
      id: style.id ?? `legacy-style-${ruleIndex + 1}-${styleIndex + 1}`,
      match: rule.match ?? "/**",
      methods: rule.methods,
      file: style.file,
      content: style.content,
    })),
  );
  return {
    id: input.id ?? "scenario",
    title: input.title ?? input.id ?? "Scenario",
    description: input.description ?? "",
    default: input.default ?? false,
    vars: input.vars ?? {},
    elementOverrides: [...(input.elementOverrides ?? []), ...legacyRules].map((rule) =>
      normalizeElementRule(rule, configDirectory),
    ),
    injectedScripts: [...(input.injectedScripts ?? []), ...legacyScripts].map((script) =>
      normalizeInjectedScript(script, configDirectory),
    ),
    injectedStyles: [...(input.injectedStyles ?? []), ...legacyStyles].map((style) =>
      normalizeInjectedStyle(style, configDirectory),
    ),
    scriptOverrides: (input.scriptOverrides ?? []).map((rule) =>
      normalizeScriptOverride(rule, configDirectory),
    ),
    routeOverrides: (input.routeOverrides ?? []).map((rule) =>
      normalizeOverride(rule, configDirectory),
    ),
    handoffs: (input.handoffs ?? []).map(normalizeHandoff),
  };
}

function assertOrigin(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot contain credentials, a query, or a fragment.`);
  }
  return parsed;
}

function validateConfig(config: BenchConfig): void {
  const publicOrigin = assertOrigin(config.server.publicOrigin, "server.publicOrigin");
  const upstreamOrigin = assertOrigin(config.upstream.origin, "upstream.origin");
  if (publicOrigin.pathname !== "/" || upstreamOrigin.pathname !== "/") {
    throw new Error("server.publicOrigin and upstream.origin must not contain a path.");
  }
  if (!Number.isInteger(config.server.port) || config.server.port < 0 || config.server.port > 65535) {
    throw new Error("server.port must be an integer between 0 and 65535.");
  }
  if (!config.server.internalPrefix.startsWith("/") || config.server.internalPrefix === "/") {
    throw new Error("server.internalPrefix must be a non-root absolute path.");
  }
  if (config.scenarios.length === 0) {
    throw new Error("At least one scenario is required.");
  }

  const scenarioIds = new Set<string>();
  let defaultCount = 0;
  for (const scenario of config.scenarios) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(scenario.id)) {
      throw new Error(`Invalid scenario id: ${scenario.id}`);
    }
    if (scenarioIds.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    scenarioIds.add(scenario.id);
    defaultCount += scenario.default ? 1 : 0;

    const handoffIds = new Set<string>();
    for (const handoff of scenario.handoffs) {
      if (!handoff.id || handoffIds.has(handoff.id)) {
        throw new Error(`Scenario ${scenario.id} contains a missing or duplicate handoff id.`);
      }
      handoffIds.add(handoff.id);
      const destination = new URL(handoff.destination, config.upstream.origin);
      if (destination.origin !== upstreamOrigin.origin) {
        throw new Error(`Handoff ${handoff.id} must remain on the configured production origin.`);
      }
      if (
        handoff.clientState.transport !== "none" &&
        handoff.clientState.stateKeys.length === 0
      ) {
        throw new Error(
          `Handoff ${handoff.id} uses client state but has no allowlisted stateKeys.`,
        );
      }
    }
  }
  if (defaultCount > 1) {
    throw new Error("Only one scenario may be marked as default.");
  }
  if (defaultCount === 0) {
    config.scenarios[0]!.default = true;
  }

  if (config.cookies.mode === "shared-parent") {
    if (!config.cookies.sharedDomain || config.cookies.sharedNames.length === 0) {
      throw new Error("shared-parent cookie mode requires sharedDomain and sharedNames.");
    }
  }
}

export function resolveBenchConfig(
  raw: RawBenchConfig,
  configDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): BenchConfig {
  const host = raw.server?.host ?? "127.0.0.1";
  const configuredPort = raw.server?.port ?? 4173;
  const envPort = environment.BENCH_PORT
    ? Number.parseInt(environment.BENCH_PORT, 10)
    : configuredPort;
  const publicOrigin =
    environment.BENCH_PUBLIC_ORIGIN ??
    raw.server?.publicOrigin ??
    `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${envPort}`;
  const upstreamOrigin =
    environment.BENCH_UPSTREAM_ORIGIN ?? raw.upstream?.origin ?? "http://127.0.0.1:4311";

  const scenarioInputs = (raw.scenarios?.length
    ? raw.scenarios
    : [DEFAULT_SCENARIO]) as RawScenario[];
  const developmentEnabled =
    environment.BENCH_DEV_MODE === "1" || raw.development?.enabled === true;

  const config: BenchConfig = {
    server: {
      host,
      port: envPort,
      publicOrigin: new URL(publicOrigin).origin,
      internalPrefix: (raw.server?.internalPrefix ?? "/__bench").replace(/\/$/, ""),
      access: {
        enabled: raw.server?.access?.enabled ?? false,
        usernameEnv: raw.server?.access?.usernameEnv ?? "BENCH_AUTH_USER",
        passwordEnv: raw.server?.access?.passwordEnv ?? "BENCH_AUTH_PASSWORD",
      },
    },
    upstream: {
      origin: new URL(upstreamOrigin).origin,
      websocket: raw.upstream?.websocket ?? true,
      rejectUnauthorized: raw.upstream?.rejectUnauthorized ?? true,
      timeoutMs: raw.upstream?.timeoutMs ?? 30_000,
    },
    security: {
      stripCsp: raw.security?.stripCsp ?? true,
      stripClearSiteData: raw.security?.stripClearSiteData ?? true,
      disableServiceWorkers: raw.security?.disableServiceWorkers ?? true,
    },
    cookies: {
      mode: raw.cookies?.mode ?? "isolate",
      sharedDomain: raw.cookies?.sharedDomain,
      sharedNames: raw.cookies?.sharedNames ?? [],
      stripSecureOnHttp: raw.cookies?.stripSecureOnHttp ?? true,
    },
    html: {
      maxBytes: raw.html?.maxBytes ?? 5 * 1024 * 1024,
      rewriteSameOriginUrls: raw.html?.rewriteSameOriginUrls ?? true,
      navigationGuard: raw.html?.navigationGuard ?? true,
      directAssets: raw.html?.directAssets ?? [],
    },
    development: {
      enabled: developmentEnabled,
      inspector: raw.development?.inspector ?? developmentEnabled,
      liveReload: raw.development?.liveReload ?? developmentEnabled,
      allowScaffolding: raw.development?.allowScaffolding ?? developmentEnabled,
    },
    scenarios: scenarioInputs.map((scenario) => normalizeScenario(scenario, configDirectory)),
    configDirectory,
    configPath: resolve(configDirectory, "bench.config.json"),
  };

  validateConfig(config);
  return config;
}

export async function loadBenchConfig(
  configPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<BenchConfig> {
  const absolutePath = resolve(configPath);
  const contents = await readFile(absolutePath, "utf8");
  let raw: RawBenchConfig;
  try {
    raw = JSON.parse(contents) as RawBenchConfig;
  } catch (error) {
    throw new Error(
      `Could not parse ${absolutePath} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config = resolveBenchConfig(raw, dirname(absolutePath), environment);
  config.configPath = absolutePath;
  return config;
}
