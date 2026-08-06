import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreOnly = process.argv.includes("--core");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cacheRoot = join(tmpdir(), "mirrorling-rc");
mkdirSync(join(cacheRoot, "npm"), { recursive: true });
mkdirSync(join(cacheRoot, "xdg"), { recursive: true });

function supportedNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

function run(label, command, args, environment = {}) {
  console.log(`\n[RC] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: join(cacheRoot, "npm"),
      XDG_CONFIG_HOME: join(cacheRoot, "xdg"),
      ...environment,
    },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Mirrorling release gate (${coreOnly ? "core" : "strict"})`);
if (!supportedNodeVersion()) {
  console.error(`Node.js ${process.versions.node} is unsupported. Use Node.js 22.13.0 or newer.`);
  process.exit(1);
}

run("repository hygiene", process.execPath, ["scripts/repo-hygiene.mjs"]);
run("TypeScript contract", npm, ["run", "typecheck"]);
run("unit and integration suite", npm, ["test"]);
run("compiled Node runtime", npm, ["run", "build"]);
console.log("\n[RC] clean Netlify output");
rmSync(join(root, ".netlify"), { recursive: true, force: true });
run(
  "Netlify production bundle",
  npm,
  ["run", "netlify:build"],
  { BENCH_UPSTREAM_ORIGIN: "https://production.invalid" },
);
run("bundled Netlify function smoke test", npm, ["run", "smoke:netlify-bundle"]);
run("dependency audit", npm, ["audit", "--audit-level=high"]);

if (!coreOnly) {
  run("browser journey", npm, ["run", "test:e2e"]);
}

console.log(`\n[RC] ${coreOnly ? "Core gate passed. Browser sign-off remains outstanding." : "Strict gate passed. This candidate is eligible for sign-off."}`);
