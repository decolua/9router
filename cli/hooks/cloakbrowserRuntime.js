// Ensure cloakbrowser (optional stealth Chromium engine) is installed in the
// user-writable automation runtime and its Chromium binary is downloaded.
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");

const { getRuntimeNodeModules } = require("./sqliteRuntime");
const {
  ensureAutomationRuntimeDir,
  getAutomationRuntimeDir,
  getAutomationRuntimeNodeModules,
  installAutomationPackages,
  requireAutomationPackage,
} = require("./automationRuntime");

const CLOAKBROWSER_PACKAGE = "cloakbrowser";
const CLOAKBROWSER_VERSION = "0.4.8";
const CLOAKBROWSER_PACKAGES = [
  `${CLOAKBROWSER_PACKAGE}@${CLOAKBROWSER_VERSION}`,
  "playwright-core@^1.54.2",
  "puppeteer-core@^24.0.0",
  "socks-proxy-agent@^10.0.0",
  "mmdb-lib@^2.0.0",
];

let cachedReady = null;

function getCloakbrowserCacheDir() {
  const overrideDir = String(process.env.CLOAKBROWSER_CACHE_DIR || "").trim();
  if (overrideDir) return path.resolve(overrideDir);
  return path.join(getAutomationRuntimeDir(), "cloakbrowser");
}

function configureCloakbrowserEnv(env = process.env) {
  if (!env.CLOAKBROWSER_CACHE_DIR) env.CLOAKBROWSER_CACHE_DIR = getCloakbrowserCacheDir();
  if (!env.CLOAKBROWSER_AUTO_UPDATE) env.CLOAKBROWSER_AUTO_UPDATE = "false";
  return env;
}

function requirePackageFromDir(packageDir, packageName) {
  try {
    return createRequire(path.join(packageDir, "package.json"))(packageName);
  } catch {
    return null;
  }
}

function tryRequireCloakbrowser() {
  try {
    return requireAutomationPackage(CLOAKBROWSER_PACKAGE);
  } catch {}
  try {
    const runtimeNm = getRuntimeNodeModules();
    const candidate = path.join(runtimeNm, CLOAKBROWSER_PACKAGE);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return requirePackageFromDir(candidate, CLOAKBROWSER_PACKAGE);
    }
  } catch {}
  try {
    return require(CLOAKBROWSER_PACKAGE);
  } catch {}
  return null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getPackageImportEntry(packageJsonPath) {
  const pkg = readJsonFile(packageJsonPath) || {};
  const rootExport = pkg.exports?.["."];
  if (typeof rootExport === "string") return rootExport;
  if (typeof rootExport?.import === "string") return rootExport.import;
  if (typeof pkg.module === "string") return pkg.module;
  if (typeof pkg.main === "string") return pkg.main;
  return "index.js";
}

async function importPackageFromJson(packageJsonPath) {
  if (!packageJsonPath || !fs.existsSync(packageJsonPath)) return null;
  try {
    const packageDir = path.dirname(packageJsonPath);
    const entry = getPackageImportEntry(packageJsonPath);
    const mod = await import(pathToFileURL(path.resolve(packageDir, entry)).href);
    return mod?.default || mod;
  } catch {
    return null;
  }
}

function getCloakbrowserPackageJsonCandidates() {
  const candidates = [];
  try {
    candidates.push(path.join(getAutomationRuntimeNodeModules(), CLOAKBROWSER_PACKAGE, "package.json"));
  } catch {}
  try {
    candidates.push(path.join(getRuntimeNodeModules(), CLOAKBROWSER_PACKAGE, "package.json"));
  } catch {}
  try {
    const packageJson = require.resolve(`${CLOAKBROWSER_PACKAGE}/package.json`);
    candidates.push(packageJson);
  } catch {}
  return [...new Set(candidates)];
}

async function importCloakbrowserModule() {
  configureCloakbrowserEnv();
  const required = tryRequireCloakbrowser();
  if (required) return required;
  for (const packageJsonPath of getCloakbrowserPackageJsonCandidates()) {
    const imported = await importPackageFromJson(packageJsonPath);
    if (imported) return imported;
  }
  return null;
}

function hasAutomationCloakbrowserPackage() {
  return fs.existsSync(path.join(getAutomationRuntimeNodeModules(), CLOAKBROWSER_PACKAGE, "package.json"));
}

function summarizeInstallStderr(stderr = "") {
  const text = String(stderr).trim();
  if (!text) return "no output";
  if (/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network/i.test(text)) {
    return "network error (registry unreachable)";
  }
  if (/EACCES|EPERM|permission denied/i.test(text)) {
    return "permission denied (check folder permissions)";
  }
  if (/ENOSPC|no space/i.test(text)) {
    return "not enough disk space";
  }
  const npmErr = text.match(/npm ERR! (.+)/);
  if (npmErr) return npmErr[1].slice(0, 200);
  return text.split(/\r?\n/).filter(Boolean).pop().slice(0, 200);
}

function installCloakbrowserOnly({ silent = false, timeout = 300_000 } = {}) {
  configureCloakbrowserEnv();
  const runtimeDir = ensureAutomationRuntimeDir();
  if (!silent) console.log("⏳ Installing cloakbrowser package...");
  const installRes = installAutomationPackages(CLOAKBROWSER_PACKAGES, {
    silent,
    timeout,
    noSave: true,
  });

  if (!installRes.ok) {
    return { ok: false, reason: summarizeInstallStderr(installRes.stderr) };
  }

  if (!hasAutomationCloakbrowserPackage()) {
    return {
      ok: false,
      reason: `cloakbrowser installed but package.json not found under ${runtimeDir} — npm may have installed to a different location`,
    };
  }

  return { ok: true };
}

async function ensureCloakbrowserBinary(mod, { silent = false } = {}) {
  configureCloakbrowserEnv();
  if (typeof mod?.ensureBinary !== "function") return { ok: true };
  if (!silent) console.log("⏳ Downloading Cloakbrowser Chromium binary (first run, ~200MB)...");
  try {
    const binaryPath = await mod.ensureBinary();
    if (binaryPath && fs.existsSync(binaryPath)) return { ok: true, binaryPath };
    return { ok: false, reason: `cloakbrowser ensureBinary returned a missing path: ${binaryPath || "unknown"}` };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

async function ensureCloakbrowserRuntime({ silent = false } = {}) {
  if (cachedReady === true) return { ok: true };

  configureCloakbrowserEnv();
  ensureAutomationRuntimeDir();
  const existing = await importCloakbrowserModule();
  if (existing?.launch) {
    const binary = await ensureCloakbrowserBinary(existing, { silent });
    if (!binary.ok) {
      cachedReady = false;
      const error = new Error(
        `Cloakbrowser Chromium binary not available. ${binary.reason}. ` +
        `Fix the 9router automation runtime at ${getAutomationRuntimeDir()}, then retry. ` +
        `You can also switch back to the Chromium engine in the bulk-import modal.`
      );
      error.code = "CLOAKBROWSER_BINARY_MISSING";
      return { ok: false, error };
    }
    cachedReady = true;
    return { ok: true, module: existing };
  }

  const installed = installCloakbrowserOnly({ silent });
  if (!installed.ok) {
    cachedReady = false;
    const error = new Error(
      `Cloakbrowser engine not available. ${installed.reason}. ` +
      `Fix the 9router automation runtime at ${getAutomationRuntimeDir()}, then retry. ` +
      `You can also switch back to the Chromium engine in the bulk-import modal.`
    );
    error.code = "CLOAKBROWSER_PACKAGE_MISSING";
    return { ok: false, error };
  }

  const mod = await importCloakbrowserModule();
  if (!mod?.launch) {
    cachedReady = false;
    const error = new Error(
      `Cloakbrowser installed into ${getAutomationRuntimeDir()}, but Node could not load it. ` +
      `Restart 9router and retry, or switch back to the Chromium engine.`
    );
    error.code = "CLOAKBROWSER_PACKAGE_MISSING";
    return { ok: false, error };
  }

  const binary = await ensureCloakbrowserBinary(mod, { silent });
  if (!binary.ok) {
    cachedReady = false;
    const error = new Error(
      `Cloakbrowser Chromium binary not available. ${binary.reason}. ` +
      `Fix the 9router automation runtime at ${getAutomationRuntimeDir()}, then retry. ` +
      `You can also switch back to the Chromium engine in the bulk-import modal.`
    );
    error.code = "CLOAKBROWSER_BINARY_MISSING";
    return { ok: false, error };
  }

  cachedReady = true;
  return { ok: true, module: mod };
}

function loadCloakbrowserModule() {
  return tryRequireCloakbrowser();
}

function resetCache() {
  cachedReady = null;
}

module.exports = {
  ensureCloakbrowserRuntime,
  installCloakbrowserOnly,
  loadCloakbrowserModule,
  importCloakbrowserModule,
  getCloakbrowserCacheDir,
  configureCloakbrowserEnv,
  ensureCloakbrowserBinary,
  resetCache,
};
