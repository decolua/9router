#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `10router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[10router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[10router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[10router] tray runtime skipped: ${e.message}`);
}

process.exit(0);
