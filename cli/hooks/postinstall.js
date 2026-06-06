#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const { execSync } = require("child_process");
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

// Optional: headroom-ai for ML context compression (60-95% token reduction).
// Not auto-installed — enable when ready: npm install -g headroom-ai && headroom proxy
try {
  execSync("headroom --version", { stdio: "ignore" });
  console.log("[9router] headroom-ai detected — run `headroom proxy` to activate ML compression");
} catch {
  console.log("[9router] tip: `npm install -g headroom-ai && headroom proxy` for ML context compression");
}

process.exit(0);
