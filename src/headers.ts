import type { IncomingHttpHeaders } from "node:http";
import { rewriteSetCookie } from "./cookies.js";
import type { BenchConfig } from "./types.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const INVALIDATED_ENTITY_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "etag",
  "content-md5",
  "accept-ranges",
]);

function rewriteOriginValue(
  value: string,
  upstreamOrigin: string,
  stagingOrigin: string,
): string {
  return value === upstreamOrigin ? stagingOrigin : value;
}

export function responseHeaders(
  source: IncomingHttpHeaders,
  config: BenchConfig,
  transformed: boolean,
): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  const stagingOrigin = new URL(config.server.publicOrigin).origin;
  const upstreamOrigin = new URL(config.upstream.origin).origin;
  const stagingIsHttps = new URL(stagingOrigin).protocol === "https:";

  for (const [name, rawValue] of Object.entries(source)) {
    if (rawValue === undefined || HOP_BY_HOP.has(name.toLowerCase())) {
      continue;
    }
    const lower = name.toLowerCase();
    if (
      config.security.stripCsp &&
      (lower === "content-security-policy" || lower === "content-security-policy-report-only")
    ) {
      continue;
    }
    if (config.security.stripClearSiteData && lower === "clear-site-data") {
      continue;
    }
    if (
      transformed &&
      INVALIDATED_ENTITY_HEADERS.has(lower)
    ) {
      continue;
    }
    if (lower === "set-cookie") {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      output[name] = values.map((cookie) =>
        rewriteSetCookie(cookie, config.cookies, stagingIsHttps),
      );
      continue;
    }
    if (lower === "location" && typeof rawValue === "string") {
      output[name] = rawValue.replaceAll(upstreamOrigin, stagingOrigin);
      continue;
    }
    if (lower === "access-control-allow-origin" && typeof rawValue === "string") {
      output[name] = rewriteOriginValue(rawValue, upstreamOrigin, stagingOrigin);
      continue;
    }
    output[name] = rawValue;
  }

  output["cache-control"] = "no-store, private";
  output["x-overlay-bench"] = "1";
  return output;
}

function fetchSetCookies(source: Headers): string[] {
  const extended = source as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values?.length) return values;
  const combined = source.get("set-cookie");
  return combined ? [combined] : [];
}

export function fetchResponseHeaders(
  source: Headers,
  config: BenchConfig,
  entityChanged: boolean,
): Headers {
  const output = new Headers();
  const stagingOrigin = new URL(config.server.publicOrigin).origin;
  const upstreamOrigin = new URL(config.upstream.origin).origin;
  const stagingIsHttps = new URL(stagingOrigin).protocol === "https:";

  for (const [name, value] of source) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "set-cookie") continue;
    if (
      config.security.stripCsp &&
      (lower === "content-security-policy" || lower === "content-security-policy-report-only")
    ) continue;
    if (config.security.stripClearSiteData && lower === "clear-site-data") continue;
    if (entityChanged && INVALIDATED_ENTITY_HEADERS.has(lower)) continue;
    if (lower === "location") {
      output.set(name, value.replaceAll(upstreamOrigin, stagingOrigin));
      continue;
    }
    if (lower === "access-control-allow-origin") {
      output.set(name, rewriteOriginValue(value, upstreamOrigin, stagingOrigin));
      continue;
    }
    output.set(name, value);
  }

  for (const cookie of fetchSetCookies(source)) {
    output.append("set-cookie", rewriteSetCookie(cookie, config.cookies, stagingIsHttps));
  }
  output.set("cache-control", "no-store, private");
  output.set("x-overlay-bench", "1");
  return output;
}
