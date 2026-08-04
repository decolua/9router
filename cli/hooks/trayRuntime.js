// Lazy install systray2 for macOS/Linux into USER_DATA_DIR/runtime/node_modules.
// Windows uses PowerShell NotifyIcon (no binary) → no systray needed.
// This keeps the published npm tarball free of unsigned Go binaries that
// trigger antivirus false positives (e.g. Kaspersky flagging tray_windows.exe).
//
// We use the maintained `systray2` fork. The original `systray@1.0.5` package
// bundles a 2017 x86_64 Go binary whose Mach-O headers are rejected by modern
// dyld (macOS 14+), so the tray silently fails to register on Apple Silicon.
const fs = require("fs");
const path = require("path");
const {
  getRuntimeNodeModules,
  installRuntimePackages,
} = require("./runtimeInstall");

const SYSTRAY_PKG = "systray2";
const SYSTRAY_VERSION = "2.1.4";
const LEGACY_SYSTRAY_PKG = "systray";

function hasSystray() {
  return fs.existsSync(path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "package.json"));
}

// Remove the legacy `systray` package from all known locations.
// On Windows it was an AV false-positive risk; on macOS/Linux its bundled
// binary is broken on modern OS versions.
function cleanupLegacySystray({ silent = false } = {}) {
  // 1) Runtime dir: ~/.9router/runtime/node_modules/systray (or %APPDATA% on Win)
  // 2) npm global nested: <npm_prefix>/node_modules/9router/node_modules/systray
  //    __dirname here = <pkg root>/hooks → up 1 = pkg root
  const targets = [
    path.join(getRuntimeNodeModules(), LEGACY_SYSTRAY_PKG),
    path.join(__dirname, "..", "node_modules", LEGACY_SYSTRAY_PKG)
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

// systray2's npm tarball sometimes ships the bundled Go binary without the
// executable bit set on macOS, causing spawn() to fail with EACCES. Set +x
// best-effort so the tray actually starts.
function chmodSystrayBin({ silent = false } = {}) {
  if (process.platform === "win32") return;
  const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
  const binPath = path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "traybin", binName);
  if (!fs.existsSync(binPath)) return;
  try {
    fs.chmodSync(binPath, 0o755);
  } catch (e) {
    if (!silent) console.warn(`[9router][runtime] chmod tray bin failed: ${e.message}`);
  }
}

// Public: ensure systray2 is installed on macOS/Linux only.
// Windows skips entirely (uses PowerShell tray).
function ensureTrayRuntime({ silent = false } = {}) {
  // Always evict the legacy `systray` package — its binary is broken on
  // modern macOS and an AV false-positive on Windows.
  cleanupLegacySystray({ silent });

  if (process.platform === "win32") {
    return { systray: false, skipped: true };
  }
  if (hasSystray()) {
    chmodSystrayBin({ silent });
    if (!silent) console.log("✅ System tray ready");
    return { systray: true };
  }
  const ok = installRuntimePackages([`${SYSTRAY_PKG}@${SYSTRAY_VERSION}`], {
    silent,
    timeout: 120000,
    label: "system tray",
    failureTitle: "System tray install failed — tray disabled",
    failureHint: "tray disabled",
  });
  if (ok) chmodSystrayBin({ silent });
  return { systray: ok && hasSystray() };
}

module.exports = { ensureTrayRuntime };
