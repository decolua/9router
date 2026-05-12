// Lazy install systray for macOS/Linux into USER_DATA_DIR/runtime/node_modules.
// Windows uses PowerShell NotifyIcon (no binary) → no systray needed.
// This keeps the published npm tarball free of unsigned Go binaries that
// trigger antivirus false positives (e.g. Kaspersky flagging tray_windows.exe).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getRuntimeDir, getRuntimeNodeModules } = require("./sqliteRuntime");

const SYSTRAY_VERSION = "1.0.5";

function hasSystray() {
  return fs.existsSync(path.join(getRuntimeNodeModules(), "systray", "package.json"));
}

// Remove legacy systray from all known locations on Windows (AV false positive cleanup)
function cleanupWindowsSystray({ silent = false } = {}) {
  if (process.platform !== "win32") return;
  // 1) Runtime dir: %APPDATA%\9router\runtime\node_modules\systray
  // 2) npm global nested: <npm_prefix>\node_modules\9router\node_modules\systray
  //    __dirname here = <npm_prefix>\node_modules\9router\hooks → up 1 = pkg root
  const targets = [
    path.join(getRuntimeNodeModules(), "systray"),
    path.join(__dirname, "..", "node_modules", "systray")
  ];
  for (const dir of targets) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        if (!silent) console.log(`[9router][runtime] removed legacy systray: ${dir}`);
      } catch (e) {
        if (!silent) console.warn(`[9router][runtime] failed to remove ${dir}: ${e.message}`);
      }
    }
  }
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-runtime",
      version: "1.0.0",
      private: true
    }, null, 2));
  }
  return dir;
}

function npmInstall(pkgs, { silent = false } = {}) {
  const cwd = ensureRuntimeDir();
  const args = ["install", ...pkgs, "--no-audit", "--no-fund", "--no-save", "--prefer-online"];
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  if (!silent) console.log(`[9router][runtime] ${npmCmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(npmCmd, args, {
    cwd,
    stdio: silent ? "ignore" : "inherit",
    timeout: 120000,
    shell: process.platform === "win32"
  });
  return res.status === 0;
}

// Public: ensure systray is installed on macOS/Linux only.
// Windows skips entirely (uses PowerShell tray).
function ensureTrayRuntime({ silent = false } = {}) {
  if (process.platform === "win32") {
    cleanupWindowsSystray({ silent });
    return { systray: false, skipped: true };
  }
  if (hasSystray()) {
    if (!silent) console.log("[9router][runtime] systray OK");
    return { systray: true };
  }
  const ok = npmInstall([`systray@${SYSTRAY_VERSION}`], { silent });
  if (!ok && !silent) {
    console.warn("[9router][runtime] systray install failed (tray will be disabled)");
  }
  return { systray: ok && hasSystray() };
}

module.exports = { ensureTrayRuntime };
