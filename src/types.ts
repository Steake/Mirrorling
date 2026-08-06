import type { IncomingMessage, ServerResponse } from "node:http";

export type StringList = string | string[];

export interface Matchable {
  match: StringList;
  methods?: string[];
}

export type CookieMode = "isolate" | "shared-parent" | "preserve";

export interface CookieConfig {
  mode: CookieMode;
  sharedDomain?: string;
  sharedNames: string[];
  stripSecureOnHttp: boolean;
}

export interface ServerAccessConfig {
  enabled: boolean;
  usernameEnv: string;
  passwordEnv: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  publicOrigin: string;
  internalPrefix: string;
  access: ServerAccessConfig;
}

export interface UpstreamConfig {
  origin: string;
  websocket: boolean;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}

export interface SecurityConfig {
  stripCsp: boolean;
  stripClearSiteData: boolean;
  disableServiceWorkers: boolean;
}

export interface DirectAssetRule {
  selector: string;
  attribute: string;
}

export interface HtmlConfig {
  maxBytes: number;
  rewriteSameOriginUrls: boolean;
  navigationGuard: boolean;
  directAssets: DirectAssetRule[];
}

export interface DevelopmentConfig {
  enabled: boolean;
  inspector: boolean;
  liveReload: boolean;
  allowScaffolding: boolean;
}

export type HtmlOperationType =
  | "replace"
  | "inner"
  | "append"
  | "prepend"
  | "before"
  | "after"
  | "remove"
  | "set-attribute";

export interface HtmlOperation {
  id?: string;
  type: HtmlOperationType;
  selector: string;
  html?: string;
  file?: string;
  template?: boolean;
  expect?: {
    count?: number;
    tag?: string;
  };
  onMismatch?: "skip" | "apply" | "error";
  attribute?: string;
  value?: string;
}

export type ScriptTiming =
  | "document-start"
  | "head-end"
  | "body-end"
  | "dom-ready"
  | "load";

export interface InjectedScript extends Matchable {
  id: string;
  file?: string;
  content?: string;
  module?: boolean;
  timing: ScriptTiming;
}

export interface InjectedStyle extends Matchable {
  id: string;
  file?: string;
  content?: string;
}

export interface ElementOverrideRule extends Matchable {
  operations: HtmlOperation[];
}

export type HtmlRule = ElementOverrideRule;

export type ScriptOverrideStrategy = "replace" | "prepend" | "append";

export interface ScriptOverride extends Matchable {
  id: string;
  strategy: ScriptOverrideStrategy;
  file?: string;
  content?: string;
}

export interface LegacyHtmlRule extends ElementOverrideRule {
  scripts?: Array<{
    id?: string;
    file?: string;
    content?: string;
    module?: boolean;
    location?: "head" | "body";
  }>;
  styles?: Array<{
    id?: string;
    file?: string;
    content?: string;
  }>;
}

export interface RouteOverride extends Matchable {
  status: number;
  headers: Record<string, string>;
  body?: string;
  file?: string;
  json?: unknown;
  delayMs: number;
}

export type ClientStateTransport = "none" | "query" | "fragment" | "window-name";

export interface HandoffClientStateConfig {
  transport: ClientStateTransport;
  parameter: string;
  stateKeys: string[];
}

export interface HandoffRule extends Matchable {
  id: string;
  destination: string;
  preservePath: boolean;
  preserveQuery: boolean;
  status: 302 | 303 | 307 | 308;
  carryQuery: string[];
  clientState: HandoffClientStateConfig;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  default: boolean;
  vars: Record<string, unknown>;
  elementOverrides: ElementOverrideRule[];
  injectedScripts: InjectedScript[];
  injectedStyles: InjectedStyle[];
  scriptOverrides: ScriptOverride[];
  routeOverrides: RouteOverride[];
  handoffs: HandoffRule[];
}

export interface BenchConfig {
  server: ServerConfig;
  upstream: UpstreamConfig;
  security: SecurityConfig;
  cookies: CookieConfig;
  html: HtmlConfig;
  development: DevelopmentConfig;
  scenarios: Scenario[];
  configDirectory: string;
  configPath: string;
}

export interface RawScenario extends Partial<Scenario> {
  id?: string;
  htmlRules?: LegacyHtmlRule[];
}

export interface RawBenchConfig {
  server?: Partial<Omit<ServerConfig, "access">> & {
    access?: Partial<ServerAccessConfig>;
  };
  upstream?: Partial<UpstreamConfig> & { origin?: string };
  security?: Partial<SecurityConfig>;
  cookies?: Partial<CookieConfig>;
  html?: Partial<HtmlConfig>;
  development?: Partial<DevelopmentConfig>;
  scenarios?: RawScenario[];
}

export interface BenchRequestContext {
  requestUrl: URL;
  upstreamUrl: URL;
  scenario: Scenario;
}

export interface TransformDiagnostic {
  level: "info" | "warning" | "error";
  kind: "selector" | "template" | "script-override" | "injection";
  id: string;
  selector?: string;
  message: string;
  matches?: number;
}

export interface BenchInstance {
  origin: string;
  listen(): Promise<void>;
  close(): Promise<void>;
  reload(config: BenchConfig): { restartRequired: string[] };
  notifyReload(reason?: string): void;
}

export type InternalHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  scenario: Scenario,
) => Promise<boolean>;
