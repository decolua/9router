// Ensure Playwright + Chromium are usable at runtime. `npm i -g klrouter`
// installs the playwright npm package but does NOT trigger its postinstall
// browser download under all package managers, so the first bulk-import
// attempt fails with "Executable doesn't exist at .../chrome-headless-shell".
// We download lazily on first launch so users who never touch automation
// aren't billed ~150MB of disk.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const { getRuntimeNodeModules } = require("./sqliteRuntime");
const {
  PLAYWRIGHT_VERSION,
  configureAutomationBrowserEnv,
  ensureAutomationRuntimeDir,
  getAutomationRuntimeDir,
  getAutomationRuntimeNodeModules,
  installAutomationPackages,
  requireAutomationPackage,
  resolveAutomationPackage,
} = require("./automationRuntime");

const PLAYWRIGHT_PACKAGE = "playwright";

let cachedReady = null;

// Walk up from `__dirname` (cli/hooks) to find the klrouter package root,
// then probe both `node_modules/playwright` (when running from source) and
// `app/node_modules/playwright` (the location used by the published npm
// package, where the bundled Next.js app keeps its deps).
function findBundledPlaywrightDirs() {
  const dirs = [];
  const visited = new Set();

  function probe(baseDir) {
    if (!baseDir) return;
    const resolved = path.resolve(baseDir);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const direct = path.join(resolved, "node_modules", PLAYWRIGHT_PACKAGE, "package.json");
    if (fs.existsSync(direct)) dirs.push(path.dirname(direct));
    const inApp = path.join(resolved, "app", "node_modules", PLAYWRIGHT_PACKAGE, "package.json");
    if (fs.existsSync(inApp)) dirs.push(path.dirname(inApp));
  }

  // hooks/ -> klrouter/ (npm published) -> walk a few levels up for safety
  let dir = path.resolve(__dirname, "..");
  for (let i = 0; i < 6 && dir; i += 1) {
    probe(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function requirePackageFromDir(packageDir, packageName) {
  try {
    return createRequire(path.join(packageDir, "package.json"))(packageName);
  } catch {
    return null;
  }
}

function tryRequirePlaywright() {
  configureAutomationBrowserEnv();
  try {
    return requireAutomationPackage(PLAYWRIGHT_PACKAGE);
  } catch {}

  try {
    const runtimeNm = getRuntimeNodeModules();
    const candidate = path.join(runtimeNm, PLAYWRIGHT_PACKAGE);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return requirePackageFromDir(candidate, PLAYWRIGHT_PACKAGE);
    }
  } catch {}

  for (const candidate of findBundledPlaywrightDirs()) {
    const mod = requirePackageFromDir(candidate, PLAYWRIGHT_PACKAGE);
    if (mod) return mod;
  }

  try {
    return require(PLAYWRIGHT_PACKAGE);
  } catch {}

  return null;
}

function hasAutomationPlaywrightPackage() {
  return fs.existsSync(path.join(getAutomationRuntimeNodeModules(), PLAYWRIGHT_PACKAGE, "package.json"));
}

function isChromiumBinaryAvailable() {
  const playwright = tryRequirePlaywright();
  if (!playwright?.chromium?.executablePath) return false;
  let executable;
  try {
    executable = playwright.chromium.executablePath();
  } catch {
    return false;
  }
  if (!executable) return false;
  return fs.existsSync(executable);
}

function findCli() {
  const candidates = [];
  try {
    const pwPkg = resolveAutomationPackage("playwright/package.json");
    candidates.push(path.join(path.dirname(pwPkg), "cli.js"));
  } catch {}
  try {
    const pwCorePkg = resolveAutomationPackage("playwright-core/package.json");
    candidates.push(path.join(path.dirname(pwCorePkg), "cli.js"));
  } catch {}
  try {
    const pwPkg = require.resolve("playwright/package.json");
    candidates.push(path.join(path.dirname(pwPkg), "cli.js"));
  } catch {}
  try {
    const pwCorePkg = require.resolve("playwright-core/package.json");
    candidates.push(path.join(path.dirname(pwCorePkg), "cli.js"));
  } catch {}
  try {
    candidates.push(path.join(getAutomationRuntimeNodeModules(), "playwright", "cli.js"));
    candidates.push(path.join(getAutomationRuntimeNodeModules(), "playwright-core", "cli.js"));
  } catch {}
  try {
    candidates.push(path.join(getRuntimeNodeModules(), "playwright", "cli.js"));
    candidates.push(path.join(getRuntimeNodeModules(), "playwright-core", "cli.js"));
  } catch {}
  for (const candidateDir of findBundledPlaywrightDirs()) {
    candidates.push(path.join(candidateDir, "cli.js"));
    candidates.push(path.join(path.dirname(path.dirname(candidateDir)), "playwright-core", "cli.js"));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
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

function ensurePlaywrightPackage({ silent = false } = {}) {
  ensureAutomationRuntimeDir();
  const mod = tryRequirePlaywright();
  if (mod) return { ok: true, module: mod };

  if (!silent) console.log("⏳ Installing playwright package (first run)...");
  const installRes = installAutomationPackages([`${PLAYWRIGHT_PACKAGE}@${PLAYWRIGHT_VERSION}`], {
    silent,
    timeout: 300_000,
  });

  if (!installRes.ok) {
    const summary = summarizeInstallStderr(installRes.stderr);
    return {
      ok: false,
      reason: `npm install playwright failed (exit ${installRes.code ?? "?"}): ${summary}`,
    };
  }

  const installed = tryRequirePlaywright();
  if (!installed) {
    const runtimeNm = getAutomationRuntimeNodeModules();
    const targetPkg = path.join(runtimeNm, PLAYWRIGHT_PACKAGE, "package.json");
    const exists = fs.existsSync(targetPkg);
    return {
      ok: false,
      reason: exists
        ? `playwright was installed to ${runtimeNm} but the automation-runtime resolver could not load it`
        : `npm install reported success but ${targetPkg} is missing — npm may have installed to a different cwd`,
    };
  }
  return { ok: true, module: installed };
}

function runInstall({ silent = false, timeout = 600_000 } = {}) {
  configureAutomationBrowserEnv();
  const cliPath = findCli();
  if (!cliPath) {
    return { ok: false, reason: "playwright cli not resolvable" };
  }

  if (!silent) console.log("⏳ Downloading Playwright Chromium (first run, ~150MB)...");

  const res = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout,
    encoding: "utf8",
    env: configureAutomationBrowserEnv({ ...process.env }),
  });

  if (res.status === 0) {
    if (!silent) console.log("✅ Playwright Chromium ready");
    return { ok: true };
  }

  const stderr = String(res.stderr || "");
  let reason = "unknown error";
  if (/ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(stderr)) reason = "no internet connection";
  else if (/EACCES|EPERM/i.test(stderr)) reason = "permission denied";
  else if (/ENOSPC/i.test(stderr)) reason = "not enough disk space";
  else if (stderr.trim()) reason = stderr.trim().split(/\r?\n/).pop().slice(0, 200);

  return { ok: false, reason };
}

function ensurePlaywrightRuntime({ silent = false, timeout } = {}) {
  if (cachedReady === true) return { ok: true };

  const pkg = ensurePlaywrightPackage({ silent });
  if (!pkg.ok) {
    cachedReady = false;
    const error = new Error(
      `Playwright not available. ${pkg.reason}. ` +
      `Fix the 9router automation runtime at ${getAutomationRuntimeDir()}, then restart and retry.`
    );
    error.code = "PLAYWRIGHT_PACKAGE_MISSING";
    return { ok: false, error };
  }

  if (isChromiumBinaryAvailable()) {
    cachedReady = true;
    return { ok: true, module: pkg.module };
  }

  const result = runInstall({ silent, timeout });
  if (result.ok && isChromiumBinaryAvailable()) {
    cachedReady = true;
    return { ok: true, module: pkg.module };
  }

  cachedReady = false;
  const error = new Error(
    `Playwright Chromium not available. ${result.reason}. ` +
    `Fix the 9router automation runtime at ${getAutomationRuntimeDir()}, then restart and retry.`
  );
  error.code = "PLAYWRIGHT_CHROMIUM_MISSING";
  return { ok: false, error };
}

function installPlaywrightOnly({ silent = false, timeout = 600_000 } = {}) {
  ensureAutomationRuntimeDir();
  if (!silent) console.log("⏳ Installing playwright package...");
  const installRes = installAutomationPackages([`${PLAYWRIGHT_PACKAGE}@${PLAYWRIGHT_VERSION}`], {
    silent,
    timeout: 300_000,
  });

  if (!installRes.ok) {
    const reason = summarizeInstallStderr(installRes.stderr);
    return { ok: false, reason };
  }

  const cliPath = path.join(getAutomationRuntimeNodeModules(), PLAYWRIGHT_PACKAGE, "cli.js");
  if (!fs.existsSync(cliPath)) {
    return {
      ok: false,
      reason: `playwright installed but cli.js not found at ${cliPath} — npm may have installed to a different location`,
    };
  }

  if (!silent) console.log("⏳ Downloading Playwright Chromium (~150MB)...");
  const res = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout,
    encoding: "utf8",
    env: configureAutomationBrowserEnv({ ...process.env }),
  });

  if (res.status === 0) {
    if (!silent) console.log("✅ Playwright Chromium ready");
    return { ok: true };
  }

  const stderr = String(res.stderr || "");
  let reason = "unknown error";
  if (/ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(stderr)) reason = "no internet connection";
  else if (/EACCES|EPERM/i.test(stderr)) reason = "permission denied";
  else if (/ENOSPC/i.test(stderr)) reason = "not enough disk space";
  else if (stderr.trim()) reason = stderr.trim().split(/\r?\n/).pop().slice(0, 200);

  return { ok: false, reason };
}

function loadPlaywrightModule() {
  return tryRequirePlaywright();
}

function resetCache() {
  cachedReady = null;
}

module.exports = {
  ensurePlaywrightRuntime,
  installPlaywrightOnly,
  loadPlaywrightModule,
  isChromiumBinaryAvailable,
  resetCache,
  findPlaywrightCli: findCli,
};
