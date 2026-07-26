#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appDir = path.resolve(cliDir, "..");
const artifactDir = path.resolve(appDir, "..");

function requireDependency(name, paths, installHint) {
  try {
    require.resolve(name, { paths });
  } catch {
    console.error(`Missing release dependency: ${name}`);
    console.error(`Install release dependencies first: ${installHint}`);
    process.exit(1);
  }
}

const mode = process.argv[2];
const supportedModes = new Set(["pack", "dry-run", "publish"]);
if (!supportedModes.has(mode)) {
  console.error("Usage: node scripts/fork-release.js <pack|dry-run|publish>");
  process.exit(1);
}

if (
  mode === "publish" &&
  !process.env.NINEROUTER_FORK_VERSION &&
  !process.env.NINEROUTER_FORK_BUILD &&
  !process.env.GITHUB_RUN_NUMBER
) {
  console.error("Refusing publish without NINEROUTER_FORK_BUILD or NINEROUTER_FORK_VERSION.");
  process.exit(1);
}

// The release build uses dependencies from both the app and CLI manifests.
// Fail before mutating temporary package versions when either set is absent.
requireDependency("semver", [cliDir, appDir], "npm ci --ignore-scripts && (cd cli && npm ci --ignore-scripts)");
requireDependency("esbuild", [cliDir], "(cd cli && npm ci --ignore-scripts)");
requireDependency("next", [appDir], "npm ci --ignore-scripts");

const { resolveForkVersion } = require("./fork-version");

const cliPkgPath = path.join(cliDir, "package.json");
const appPkgPath = path.join(appDir, "package.json");
const originals = new Map([
  [cliPkgPath, fs.readFileSync(cliPkgPath, "utf8")],
  [appPkgPath, fs.readFileSync(appPkgPath, "utf8")],
]);

const cliPkg = JSON.parse(originals.get(cliPkgPath));
const appPkg = JSON.parse(originals.get(appPkgPath));
if (cliPkg.name !== "@loldlm1/9router") {
  console.error(`Refusing release for unexpected package: ${cliPkg.name}`);
  process.exit(1);
}

const releaseVersion = resolveForkVersion(appPkg.version);
cliPkg.version = releaseVersion;
appPkg.version = releaseVersion;

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: cliDir,
    stdio: "inherit",
    env: { ...process.env, NINEROUTER_RELEASE_VERSION: releaseVersion },
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

try {
  writeJson(cliPkgPath, cliPkg);
  writeJson(appPkgPath, appPkg);
  console.log(`Preparing ${cliPkg.name}@${releaseVersion}`);

  run(process.execPath, [path.join(__dirname, "build-cli.js")]);

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  if (mode === "pack") {
    run(npmCommand, ["pack", "--pack-destination", artifactDir]);
  } else if (mode === "dry-run") {
    run(npmCommand, ["pack", "--dry-run", "--json"]);
  } else {
    // This scoped package is independent from upstream, so latest can safely
    // point to the newest maintained fork build despite its prerelease version.
    run(npmCommand, ["publish", "--access", "public", "--tag", "latest"]);
  }
} finally {
  for (const [file, contents] of originals) fs.writeFileSync(file, contents);
}
