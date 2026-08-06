#!/usr/bin/env node
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { RawBenchConfig } from "./types.js";

interface SetupOptions {
  configPath: string;
  production?: string;
  publicOrigin?: string;
  host?: string;
  port?: number;
}

function optionValue(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index < 0) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parseOptions(arguments_: string[]): SetupOptions {
  const portText = optionValue(arguments_, "--port");
  const port = portText ? Number.parseInt(portText, 10) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  return {
    configPath: resolve(optionValue(arguments_, "--config") ?? "bench.config.json"),
    production: optionValue(arguments_, "--production"),
    publicOrigin: optionValue(arguments_, "--public-origin"),
    host: optionValue(arguments_, "--host"),
    port,
  };
}

async function existingConfig(path: string): Promise<RawBenchConfig | undefined> {
  try {
    await access(path, constants.R_OK);
    return JSON.parse(await readFile(path, "utf8")) as RawBenchConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function normalizedOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  return url.origin;
}

async function askRequired(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  initial?: string,
): Promise<string> {
  while (true) {
    const answer = (await readline.question(`${prompt}${initial ? ` [${initial}]` : ""}: `)).trim();
    const value = answer || initial;
    if (value) return value;
    output.write("A value is required.\n");
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const existing = await existingConfig(options.configPath);
  const readline = createInterface({ input, output });

  try {
    output.write("\nMirrorling setup\n\n");
    const productionInput =
      options.production ??
      (await askRequired(readline, "Production URL", existing?.upstream?.origin));
    const productionUrl = new URL(productionInput);
    const productionOrigin = normalizedOrigin(productionInput, "Production URL");

    const host =
      options.host ??
      (await askRequired(readline, "Listen address", existing?.server?.host ?? "127.0.0.1"));
    const currentPort = options.port ?? existing?.server?.port ?? 4173;
    const portAnswer = options.port
      ? String(options.port)
      : await askRequired(readline, "Listen port", String(currentPort));
    const port = Number.parseInt(portAnswer, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Listen port must be an integer between 1 and 65535.");
    }

    const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const suggestedPublicOrigin = existing?.server?.publicOrigin ?? `http://${localHost}:${port}`;
    const publicInput =
      options.publicOrigin ??
      (await askRequired(readline, "Public staging origin", suggestedPublicOrigin));
    const publicOrigin = normalizedOrigin(publicInput, "Public staging origin");

    const config: RawBenchConfig = {
      server: {
        host,
        port,
        publicOrigin,
        internalPrefix: existing?.server?.internalPrefix ?? "/__bench",
        access: existing?.server?.access ?? {
          enabled: false,
          usernameEnv: "BENCH_AUTH_USER",
          passwordEnv: "BENCH_AUTH_PASSWORD",
        },
      },
      upstream: {
        origin: productionOrigin,
        websocket: existing?.upstream?.websocket ?? true,
        rejectUnauthorized: existing?.upstream?.rejectUnauthorized ?? true,
        timeoutMs: existing?.upstream?.timeoutMs ?? 30_000,
      },
      security: existing?.security ?? {
        stripCsp: true,
        stripClearSiteData: true,
        disableServiceWorkers: true,
      },
      cookies: existing?.cookies ?? {
        mode: "isolate",
        sharedNames: [],
        stripSecureOnHttp: true,
      },
      html: existing?.html ?? {
        maxBytes: 5 * 1024 * 1024,
        rewriteSameOriginUrls: true,
        navigationGuard: true,
        directAssets: [
          { selector: "img[src]", attribute: "src" },
          { selector: "source[src]", attribute: "src" },
          { selector: "source[srcset]", attribute: "srcset" },
          { selector: "video[src]", attribute: "src" },
        ],
      },
      development: existing?.development ?? {
        enabled: false,
        inspector: true,
        liveReload: true,
        allowScaffolding: true,
      },
      scenarios: existing?.scenarios ?? [
        {
          id: "baseline",
          title: "Production mirror",
          description: "Production mirrored without experiment overlays.",
          default: true,
          vars: {},
          elementOverrides: [],
          injectedScripts: [],
          injectedStyles: [],
          scriptOverrides: [],
          routeOverrides: [],
          handoffs: [],
        },
      ],
    };

    await writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    const initialPath = `${productionUrl.pathname}${productionUrl.search}${productionUrl.hash}`;
    output.write(`\nSaved ${options.configPath}\n`);
    output.write("Start with: npm start\n");
    output.write(`Open: ${new URL(initialPath, publicOrigin).href}\n\n`);
  } finally {
    readline.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
