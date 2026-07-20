const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const { runNpmInstall, summarizeNpmError } = require("./sqliteRuntime");

const PLAYWRIGHT_VERSION = "1.54.2";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "9router")
    : path.join(os.homedir(), ".9router");
}

function getAutomationRuntimeDir() {
  const overrideDir = String(process.env.NINEROUTER_AUTOMATION_RUNTIME_DIR || "").trim();
  if (overrideDir) return path.resolve(overrideDir);
  return path.join(getDataDir(), "automation-runtime");
}

function getAutomationRuntimeNodeModules() {
  return path.join(getAutomationRuntimeDir(), "node_modules");
}

function getAutomationRuntimePackageJson() {
  return path.join(getAutomationRuntimeDir(), "package.json");
}

function getAutomationBrowsersDir() {
  return path.join(getAutomationRuntimeDir(), "ms-playwright");
}

function configureAutomationBrowserEnv(env = process.env) {
  const browsersDir = getAutomationBrowsersDir();
  if (!fs.existsSync(browsersDir)) fs.mkdirSync(browsersDir, { recursive: true });
  if (!env.PLAYWRIGHT_BROWSERS_PATH) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  }
  return env;
}

function ensureAutomationRuntimeDir() {
  const dir = getAutomationRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  configureAutomationBrowserEnv();

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-automation-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable browser automation runtime for 9router",
      dependencies: {},
      optionalDependencies: {},
    }, null, 2));
  }
  return dir;
}

function createAutomationRuntimeRequire() {
  ensureAutomationRuntimeDir();
  return createRequire(getAutomationRuntimePackageJson());
}

function requireAutomationPackage(spec) {
  return createAutomationRuntimeRequire()(spec);
}

function resolveAutomationPackage(spec) {
  return createAutomationRuntimeRequire().resolve(spec);
}

function installAutomationPackages(pkgs, { silent = false, timeout = 300_000, noSave = false } = {}) {
  const cwd = ensureAutomationRuntimeDir();
  const extraArgs = noSave ? ["--no-save"] : [];
  const result = runNpmInstall({ cwd, pkgs, extraArgs, timeout });
  if (!result.ok && !silent) {
    console.warn(`[9router] automation runtime install failed: ${summarizeNpmError(result.stderr)}`);
    console.warn(`[9router] retry manually: cd "${cwd}" && npm install ${pkgs.join(" ")}`);
  }
  return result;
}

configureAutomationBrowserEnv();

module.exports = {
  PLAYWRIGHT_VERSION,
  configureAutomationBrowserEnv,
  ensureAutomationRuntimeDir,
  getAutomationBrowsersDir,
  getAutomationRuntimeDir,
  getAutomationRuntimeNodeModules,
  requireAutomationPackage,
  resolveAutomationPackage,
  installAutomationPackages,
};
