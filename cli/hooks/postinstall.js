#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.durindoor/runtime so the first
// `durindoor` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing. (Legacy ~/.9router is
// migrated by migrateLegacy below.)
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[durindoor] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[durindoor] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[durindoor] tray runtime skipped: ${e.message}`);
}

try {
  require("./migrateLegacy").migrateLegacy9router();
} catch (e) {
  console.warn("[durindoor] legacy migration skipped:", e.message);
}

process.exit(0);
