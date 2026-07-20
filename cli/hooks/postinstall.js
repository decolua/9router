#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");
const { ensurePlaywrightRuntime } = require("./playwrightRuntime");
const { ensureCloakbrowserRuntime } = require("./cloakbrowserRuntime");

const DEFAULT_AUTOMATION_ENGINES = ["chromium"];
const ALL_AUTOMATION_ENGINES = ["chromium", "cloakbrowser"];

function normalizeAutomationEngine(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "chrome" || normalized === "playwright") return "chromium";
  if (normalized === "cloak" || normalized === "cloackbrowser") return "cloakbrowser";
  return ALL_AUTOMATION_ENGINES.includes(normalized) ? normalized : "";
}

function resolveAutomationEngines(env = process.env) {
  const raw = String(env.NINEROUTER_INSTALL_AUTOMATION_ENGINES || env.KLROUTER_INSTALL_AUTOMATION_ENGINES || "").trim();
  const engines = new Set();

  if (!raw) {
    DEFAULT_AUTOMATION_ENGINES.forEach((engine) => engines.add(engine));
  } else if (/^(1|true|yes|all|\*)$/i.test(raw)) {
    ALL_AUTOMATION_ENGINES.forEach((engine) => engines.add(engine));
  } else if (!/^(0|false|no|none|off)$/i.test(raw)) {
    raw.split(/[\s,]+/).forEach((entry) => {
      const engine = normalizeAutomationEngine(entry);
      if (engine) engines.add(engine);
    });
  }

  if (env.NINEROUTER_INSTALL_CLOAKBROWSER === "1") engines.add("cloakbrowser");
  return engines;
}

async function warmRuntime({ label, readyMessage, skippedMessage, ensure, consoleLike }) {
  try {
    const result = await ensure({ silent: false });
    if (!result?.ok) {
      consoleLike.warn(`[9router] ${skippedMessage}: ${result?.error?.message || `${label} unavailable`}`);
    } else {
      consoleLike.log(`[9router] ${readyMessage}`);
    }
  } catch (e) {
    consoleLike.warn(`[9router] ${skippedMessage}: ${e.message}`);
  }
}

async function runPostinstall({ env = process.env, consoleLike = console } = {}) {
  try {
    ensureSqliteRuntime({ silent: false });
    consoleLike.log("[9router] runtime SQLite deps ready");
  } catch (e) {
    consoleLike.warn(`[9router] runtime warm-up skipped: ${e.message}`);
  }

  try {
    ensureTrayRuntime({ silent: false });
  } catch (e) {
    consoleLike.warn(`[9router] tray runtime skipped: ${e.message}`);
  }

  const engines = resolveAutomationEngines(env);
  if (engines.has("chromium")) {
    await warmRuntime({
      label: "Chromium",
      readyMessage: "browser automation Chromium ready",
      skippedMessage: "browser automation Chromium skipped",
      ensure: ensurePlaywrightRuntime,
      consoleLike,
    });
  }

  if (engines.has("cloakbrowser")) {
    await warmRuntime({
      label: "Cloakbrowser",
      readyMessage: "browser automation Cloakbrowser ready",
      skippedMessage: "browser automation Cloakbrowser skipped",
      ensure: ensureCloakbrowserRuntime,
      consoleLike,
    });
  }

  return 0;
}

if (require.main === module) {
  runPostinstall()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.warn(`[9router] postinstall skipped: ${error.message}`);
      process.exit(0);
    });
}

module.exports = {
  runPostinstall,
  resolveAutomationEngines,
  normalizeAutomationEngine,
};
