import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { BenchConfig, HandoffRule, Scenario } from "./types.js";

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeHeader(
  header: string | undefined,
  config: BenchConfig,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!config.server.access.enabled) {
    return true;
  }

  const username = environment[config.server.access.usernameEnv];
  const password = environment[config.server.access.passwordEnv];
  if (!username || !password) {
    throw new Error(
      `Staging access is enabled but ${config.server.access.usernameEnv} or ${config.server.access.passwordEnv} is unset.`,
    );
  }

  if (!header?.startsWith("Basic ")) {
    return false;
  }
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return (
      separator >= 0 &&
      equalText(decoded.slice(0, separator), username) &&
      equalText(decoded.slice(separator + 1), password)
    );
  } catch {
    return false;
  }
}

export function authorizeRequest(
  request: IncomingMessage,
  config: BenchConfig,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return authorizeHeader(request.headers.authorization, config, environment);
}

export function buildHandoffDestination(
  rule: HandoffRule,
  requestUrl: URL,
  config: BenchConfig,
): URL {
  const destination = new URL(rule.destination, config.upstream.origin);
  if (rule.preservePath) {
    destination.pathname = requestUrl.pathname;
  }
  if (rule.preserveQuery) {
    for (const [name, value] of requestUrl.searchParams) {
      if (!name.startsWith("__bench_")) {
        destination.searchParams.append(name, value);
      }
    }
  } else {
    for (const name of rule.carryQuery) {
      for (const value of requestUrl.searchParams.getAll(name)) {
        destination.searchParams.append(name, value);
      }
    }
  }
  return destination;
}

export function buildHandoffLocation(input: {
  rule: HandoffRule;
  request: IncomingMessage;
  requestUrl: URL;
  scenario: Scenario;
  config: BenchConfig;
}): URL {
  const { rule, requestUrl, config } = input;
  const destination = buildHandoffDestination(rule, requestUrl, config);
  if (destination.origin !== new URL(config.upstream.origin).origin) {
    throw new Error("Refusing a handoff outside the configured production origin.");
  }
  return destination;
}
