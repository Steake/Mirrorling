import { minimatch } from "minimatch";
import type { Matchable, StringList } from "./types.js";

export function toList(value: StringList): string[] {
  return Array.isArray(value) ? value : [value];
}

export function matchesPath(pathname: string, patterns: StringList): boolean {
  return toList(patterns).some((pattern) =>
    minimatch(pathname, pattern, {
      dot: true,
      nocase: false,
      matchBase: false,
    }),
  );
}

export function matchesRequest(
  rule: Matchable,
  pathname: string,
  method: string | undefined,
): boolean {
  if (!matchesPath(pathname, rule.match)) {
    return false;
  }

  if (!rule.methods || rule.methods.length === 0) {
    return true;
  }

  const normalizedMethod = (method ?? "GET").toUpperCase();
  return rule.methods.some((candidate) => candidate.toUpperCase() === normalizedMethod);
}
