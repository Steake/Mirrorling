import type { CookieConfig } from "./types.js";

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) {
    return result;
  }

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) {
      result[name] = value;
    }
  }
  return result;
}

function cookieName(setCookie: string): string {
  const first = setCookie.split(";", 1)[0] ?? "";
  const separator = first.indexOf("=");
  return separator > 0 ? first.slice(0, separator).trim() : "";
}

export function rewriteSetCookie(
  setCookie: string,
  config: CookieConfig,
  stagingIsHttps: boolean,
): string {
  if (config.mode === "preserve") {
    return setCookie;
  }

  const name = cookieName(setCookie);
  const attributes = setCookie.split(";").map((part) => part.trim());
  const base = attributes.shift() ?? setCookie;
  const filtered = attributes.filter((attribute) => {
    const lower = attribute.toLowerCase();
    if (lower.startsWith("domain=")) {
      return false;
    }
    if (!stagingIsHttps && config.stripSecureOnHttp && lower === "secure") {
      return false;
    }
    return true;
  });

  const mayShare =
    config.mode === "shared-parent" &&
    Boolean(config.sharedDomain) &&
    config.sharedNames.includes(name) &&
    !name.startsWith("__Host-");

  if (mayShare) {
    filtered.push(`Domain=${config.sharedDomain}`);
  }

  return [base, ...filtered].join("; ");
}
