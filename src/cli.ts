#!/usr/bin/env node
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { loadBenchConfig, resolveBenchConfig } from "./config.js";
import { createBench } from "./server.js";

interface CliOptions {
  configPath?: string;
  upstreamInput?: string;
  publicOrigin?: string;
  host?: string;
  port?: number;
  temporary: boolean;
  dev: boolean;
  help: boolean;
}

const HELP = `Mirrorling

Mirror any production origin immediately:
  npm run mirror -- https://production.example

Author overlays with page inspection and live reload:
  npm run dev -- https://production.example/page

Use a persistent setup:
  npm run setup
  npm start

Options:
  --upstream <url>       Production URL or origin
  --public-origin <url>  Externally visible staging origin
  --host <address>       Listen address (default: 127.0.0.1)
  --port <number>        Listen port (default: 4173)
  --config <file>        JSON configuration (default: bench.config.json)
  --temporary            Ignore saved scenarios and run the baseline mirror
  --dev                  Enable inspector, scaffolding and live reload
  --help                 Show this help
`;

function valueAfter(arguments_: string[], index: number, flag: string): string {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseCli(arguments_: string[]): CliOptions {
  const options: CliOptions = { temporary: false, dev: false, help: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    switch (argument) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--temporary":
        options.temporary = true;
        break;
      case "--dev":
        options.dev = true;
        break;
      case "--config":
        options.configPath = valueAfter(arguments_, index, argument);
        index += 1;
        break;
      case "--upstream":
        options.upstreamInput = valueAfter(arguments_, index, argument);
        index += 1;
        break;
      case "--public-origin":
        options.publicOrigin = valueAfter(arguments_, index, argument);
        index += 1;
        break;
      case "--host":
        options.host = valueAfter(arguments_, index, argument);
        index += 1;
        break;
      case "--port": {
        const value = Number.parseInt(valueAfter(arguments_, index, argument), 10);
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new Error("--port must be an integer between 1 and 65535.");
        }
        options.port = value;
        index += 1;
        break;
      }
      default:
        if (argument.startsWith("--")) {
          throw new Error(`Unknown option: ${argument}`);
        }
        if (options.upstreamInput) {
          throw new Error(`Unexpected argument: ${argument}`);
        }
        options.upstreamInput = argument;
    }
  }
  return options;
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function upstreamSelection(input: string | undefined): {
  origin?: string;
  initialPath: string;
} {
  if (!input) {
    return { initialPath: "/" };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("The production URL must be an absolute HTTP or HTTPS URL.");
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("The production URL must use HTTP or HTTPS.");
  }
  return {
    origin: url.origin,
    initialPath: `${url.pathname}${url.search}${url.hash}`,
  };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const selected = upstreamSelection(options.upstreamInput);
  const environment: NodeJS.ProcessEnv = { ...process.env };
  if (selected.origin) environment.BENCH_UPSTREAM_ORIGIN = selected.origin;
  if (options.publicOrigin) environment.BENCH_PUBLIC_ORIGIN = options.publicOrigin;
  if (options.port) environment.BENCH_PORT = String(options.port);
  if (options.dev) environment.BENCH_DEV_MODE = "1";

  const defaultConfigPath = resolve("bench.config.json");
  const requestedConfigPath = options.configPath ? resolve(options.configPath) : defaultConfigPath;
  const hasConfig = await readable(requestedConfigPath);

  if (options.configPath && !hasConfig) {
    throw new Error(`Configuration file not found: ${requestedConfigPath}`);
  }
  if (!options.temporary && !hasConfig && !selected.origin && !environment.BENCH_UPSTREAM_ORIGIN) {
    throw new Error(
      "No production URL is configured. Run `npm run mirror -- https://production.example` or `npm run setup`.",
    );
  }

  const config =
    !options.temporary && hasConfig
      ? await loadBenchConfig(requestedConfigPath, environment)
      : resolveBenchConfig(
          {
            server: {
              host: options.host ?? "127.0.0.1",
              port: options.port ?? 4173,
            },
          },
          process.cwd(),
          environment,
        );
  if (options.host) config.server.host = options.host;
  config.configPath = requestedConfigPath;

  const bench = createBench(config);
  await bench.listen();
  const initialUrl = new URL(selected.initialPath, bench.origin);
  console.log(`[mirrorling] Open ${initialUrl.href}\n[mirrorling] Controls ${new URL(`${config.server.internalPrefix}/`, bench.origin).href}`);
  if (config.development.enabled) {
    console.log("[mirrorling] Dev tools enabled: use the Mirrorling toolbar in the borrowed page");
  }

  let watcher: FSWatcher | undefined;
  if (config.development.enabled) {
    let reloadTimer: NodeJS.Timeout | undefined;
    const reload = (changedPath: string) => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void (async () => {
          try {
            if (resolve(changedPath) === requestedConfigPath && await readable(requestedConfigPath)) {
              const next = await loadBenchConfig(requestedConfigPath, environment);
              const { restartRequired } = bench.reload(next);
              if (restartRequired.length) {
                console.warn(`[mirrorling] Restart required for: ${restartRequired.join(", ")}`);
              }
              console.log("[mirrorling] Configuration reloaded");
            }
            bench.notifyReload(changedPath);
          } catch (error) {
            console.error(`[mirrorling] Reload skipped: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      }, 120);
    };
    watcher = watch([config.configDirectory, requestedConfigPath], {
      ignoreInitial: true,
      ignored: (path) => /(?:^|[/\\])(?:node_modules|dist|\.git)(?:[/\\]|$)/.test(path) || path.endsWith(".zip"),
    });
    watcher.on("add", reload).on("change", reload).on("unlink", reload);
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (watcher) await watcher.close();
    await bench.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error("\nRun `npm start -- --help` for usage.");
  process.exitCode = 1;
});
