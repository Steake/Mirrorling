import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { RouteOverride } from "./types.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function sendOverride(
  rule: RouteOverride,
  response: ServerResponse,
): Promise<void> {
  if (rule.delayMs > 0) {
    await sleep(rule.delayMs);
  }

  let body: string | Buffer = rule.body ?? "";
  const headers: Record<string, string> = {
    "cache-control": "no-store, private",
    "x-overlay-bench": "override",
    ...rule.headers,
  };

  if (rule.file) {
    body = await readFile(rule.file);
  } else if (rule.json !== undefined) {
    body = JSON.stringify(rule.json);
    headers["content-type"] ??= "application/json; charset=utf-8";
  } else {
    headers["content-type"] ??= "text/plain; charset=utf-8";
  }

  headers["content-length"] = String(Buffer.byteLength(body));
  response.writeHead(rule.status, headers);
  response.end(body);
}
