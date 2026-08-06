import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const required = [
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "GITHUB.md",
  "docs/brand/mirrorling-hero.png",
  "docs/brand/mirrorling-icon.png",
  "docs/brand/mirrorling-social-preview.png",
  "docs/mirrorling-inspector.png",
  "LICENSE",
  "README.md",
  "RELEASE.md",
  "SECURITY.md",
  "bench.config.json",
  "bench.config.example.json",
  "netlify.toml",
  "netlify/functions/bench.mts",
  "package-lock.json",
  "package.json",
  "scripts/capture-readme.mjs",
];
const ignoredDirectories = new Set([
  ".git",
  ".netlify",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function fail(message) {
  failures.push(message);
}

function filesBelow(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const absolute = join(directory, name);
    if (statSync(absolute).isDirectory()) entries.push(...filesBelow(absolute));
    else entries.push(absolute);
  }
  return entries;
}

for (const path of required) {
  if (!existsSync(join(root, path))) fail(`missing publication file: ${path}`);
}

const socialPreviewPath = join(root, "docs/brand/mirrorling-social-preview.png");
if (existsSync(socialPreviewPath)) {
  const preview = readFileSync(socialPreviewPath);
  const pngSignature = "89504e470d0a1a0a";
  if (preview.length < 24 || preview.subarray(0, 8).toString("hex") !== pngSignature) {
    fail("GitHub social preview must be a valid PNG");
  } else {
    const width = preview.readUInt32BE(16);
    const height = preview.readUInt32BE(20);
    if (width !== 1280 || height !== 640) {
      fail(`GitHub social preview must be exactly 1280x640, found ${width}x${height}`);
    }
  }
  if (statSync(socialPreviewPath).size >= 1_000_000) {
    fail("GitHub social preview must remain below 1 MB");
  }
}

for (const absolute of filesBelow(root)) {
  const path = relative(root, absolute);
  if ([".yaml", ".yml"].includes(extname(path).toLowerCase())) {
    fail(`YAML is forbidden in the authored repository: ${path}`);
  }
  if (/\.(?:pem|p12|pfx|key)$/i.test(path)) {
    fail(`possible private key or certificate material: ${path}`);
  }
  if (/(?:^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example") {
    fail(`environment file must not be published: ${path}`);
  }
}

for (const path of ["package.json", "package-lock.json", "bench.config.json", "bench.config.example.json"]) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) continue;
  try {
    JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (packageJson.name !== "mirrorling") fail("package.json must use the publication name: mirrorling");
if (packageJson.private !== true) fail("package.json must remain private to prevent accidental npm publication");
if (packageJson.license !== "MIT") fail("package.json license must be MIT");
if (!/^\d+\.\d+\.\d+-rc\.\d+$/.test(packageJson.version ?? "")) {
  fail("package.json version must identify a release candidate");
}
if (packageJson.engines?.node !== ">=22.13.0") {
  fail("package.json must state the tested Node.js floor: >=22.13.0");
}
for (const script of ["build", "test", "test:e2e", "netlify:build", "smoke:netlify-bundle", "rc:gate", "rc:gate:core"]) {
  if (!packageJson.scripts?.[script]) fail(`package.json is missing script: ${script}`);
}

const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
for (const ignored of ["node_modules/", "dist/", ".netlify/", ".env"]) {
  if (!gitignore.split(/\r?\n/).includes(ignored)) fail(`.gitignore must contain ${ignored}`);
}

if (failures.length > 0) {
  console.error("Repository hygiene failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Repository hygiene passed (${packageJson.version}; no authored YAML or obvious secret material).`);
