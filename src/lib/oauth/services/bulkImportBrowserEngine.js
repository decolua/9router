import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function resolveRuntimeModuleDir(metaUrl = import.meta.url) {
  try {
    const filePath = fileURLToPath(metaUrl);
    if (filePath.includes(`${path.sep}_next${path.sep}server${path.sep}`) && !fs.existsSync(filePath)) {
      return process.cwd();
    }
    return path.dirname(filePath);
  } catch {
    return process.cwd();
  }
}

const currentDir = resolveRuntimeModuleDir();
const importRuntimeModule = Function("specifier", "return import(specifier)");

const SUPPORTED_ENGINES = new Set(["chromium", "cloakbrowser"]);
export const DEFAULT_BULK_IMPORT_ENGINE = "chromium";

export function normalizeBulkImportEngine(value) {
  if (typeof value !== "string") return DEFAULT_BULK_IMPORT_ENGINE;
  const lower = value.trim().toLowerCase();
  return SUPPORTED_ENGINES.has(lower) ? lower : DEFAULT_BULK_IMPORT_ENGINE;
}

export function buildBrowserProxyOption(proxyUrl) {
  const clean = String(proxyUrl || "").trim();
  if (!clean) return null;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { server: clean };
  }
  const server = `${parsed.protocol}//${parsed.host}`;
  const proxy = { server };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  return proxy;
}

async function tryLoadRuntimeHelper(filePath) {
  try {
    const mod = await importRuntimeModule(pathToFileURL(filePath).href);
    return mod?.default || mod;
  } catch {
    return null;
  }
}

async function loadRuntimeHelperFromRoot(rootDir, name) {
  if (!rootDir) return null;
  let dir = path.resolve(rootDir);
  for (let depth = 0; depth < 10; depth += 1) {
    for (const relativeFile of [`cli/hooks/${name}.js`, `hooks/${name}.js`]) {
      const candidate = path.join(dir, relativeFile);
      if (!fs.existsSync(candidate)) continue;
      const helper = await tryLoadRuntimeHelper(candidate);
      if (helper) return helper;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function loadRuntimeHelper(name) {
  const helperOverrides = globalThis.__bulkImportBrowserRuntimeHelpers;
  if (helperOverrides && Object.prototype.hasOwnProperty.call(helperOverrides, name)) {
    return helperOverrides[name];
  }

  const directSpecs = [
    `../../../../cli/hooks/${name}`,
    `../../../../../hooks/${name}`,
    `../../../../hooks/${name}`,
  ];

  for (const spec of directSpecs) {
    const filePath = path.resolve(currentDir, `${spec}.js`);
    if (!fs.existsSync(filePath)) continue;
    const helper = await tryLoadRuntimeHelper(filePath);
    if (helper) return helper;
  }

  const roots = [
    currentDir,
    process.cwd(),
    process.argv?.[1] ? path.dirname(process.argv[1]) : "",
  ];
  for (const root of roots) {
    const helper = await loadRuntimeHelperFromRoot(root, name);
    if (helper) return helper;
  }

  return null;
}

async function importOptionalModule(specifier) {
  try {
    const mod = await importRuntimeModule(specifier);
    return mod?.default || mod;
  } catch {
    return null;
  }
}

function loadRuntimePlaywright(runtime) {
  try {
    return runtime?.loadPlaywrightModule?.() || null;
  } catch {
    return null;
  }
}

async function loadRuntimeCloakbrowser(runtime) {
  try {
    return await runtime?.importCloakbrowserModule?.() || runtime?.loadCloakbrowserModule?.() || null;
  } catch {
    return null;
  }
}

async function launchChromium({ proxyUrl, headless = true, args = [] } = {}) {
  let chromium;
  const runtime = await loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ensured = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Playwright automation runtime is not available.");
      err.code = err.code || "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
  }
  const existingRuntimePlaywright = loadRuntimePlaywright(runtime) || await importOptionalModule("playwright");
  if (existingRuntimePlaywright?.chromium) {
    chromium = existingRuntimePlaywright.chromium;
  } else {
    if (!runtime?.installPlaywrightOnly) {
      const err = new Error(
        "Playwright not installed and runtime helper unavailable. Reinstall klrouter, then retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installPlaywrightOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Playwright auto-install failed: ${installed.reason}. Run "klrouter doctor" or reinstall klrouter, then retry.`
      );
      err.code = "PLAYWRIGHT_INSTALL_FAILED";
      throw err;
    }
    const installedRuntimePlaywright = loadRuntimePlaywright(runtime) || await importOptionalModule("playwright");
    if (!installedRuntimePlaywright?.chromium) {
      const err = new Error(
        "Playwright installed into the 9router automation runtime, but Node could not load it. Restart klrouter and retry."
      );
      err.code = "PLAYWRIGHT_PACKAGE_MISSING";
      throw err;
    }
    chromium = installedRuntimePlaywright.chromium;
  }
  const options = { headless };
  if (args.length) options.args = args;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) options.proxy = proxy;
  return chromium.launch(options);
}

async function launchCloakbrowser({ proxyUrl, headless = true, args = [] } = {}) {
  let cloakbrowser;
  const runtime = await loadRuntimeHelper("cloakbrowserRuntime");
  if (runtime?.ensureCloakbrowserRuntime) {
    const ensured = await runtime.ensureCloakbrowserRuntime({ silent: false });
    if (!ensured?.ok) {
      const err = ensured?.error || new Error("Cloakbrowser automation runtime is not available.");
      err.code = err.code || "CLOAKBROWSER_PACKAGE_MISSING";
      throw err;
    }
  }

  cloakbrowser = await loadRuntimeCloakbrowser(runtime) || await importOptionalModule("cloakbrowser");
  if (!cloakbrowser) {
    if (!runtime?.installCloakbrowserOnly) {
      const err = new Error(
        "Cloakbrowser not installed and runtime helper unavailable. Reinstall klrouter or pick the Chromium engine."
      );
      err.code = "CLOAKBROWSER_PACKAGE_MISSING";
      throw err;
    }
    const installed = runtime.installCloakbrowserOnly({ silent: false });
    if (!installed.ok) {
      const err = new Error(
        `Cloakbrowser auto-install failed: ${installed.reason}. Restart 9router and retry, or switch back to the Chromium engine.`
      );
      err.code = "CLOAKBROWSER_INSTALL_FAILED";
      throw err;
    }
    cloakbrowser = await loadRuntimeCloakbrowser(runtime) || await importOptionalModule("cloakbrowser");
  }

  if (!cloakbrowser?.launch) {
    const err = new Error(
      "cloakbrowser loaded but does not expose launch(); reinstall the package or pick the Chromium engine."
    );
    err.code = "CLOAKBROWSER_API_MISMATCH";
    throw err;
  }

  const launchOptions = { headless };
  if (args.length) launchOptions.args = args;
  const proxy = buildBrowserProxyOption(proxyUrl);
  if (proxy) launchOptions.proxy = proxy;
  return cloakbrowser.launch(launchOptions);
}

export async function launchBulkImportBrowser({ engine = DEFAULT_BULK_IMPORT_ENGINE, proxyUrl, headless = true, args = [] } = {}) {
  const normalized = normalizeBulkImportEngine(engine);
  if (normalized === "cloakbrowser") {
    return launchCloakbrowser({ proxyUrl, headless, args });
  }
  return launchChromium({ proxyUrl, headless, args });
}

export function makeBrowserLauncher({ engine, proxyUrl, headless, args } = {}) {
  return () => launchBulkImportBrowser({ engine, proxyUrl, headless, args });
}
