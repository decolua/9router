const { exec, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;
let isWinTray = false;

// How long to wait for systray2's Go child to write its stdout handshake
// before treating the tray as failed.
const TRAY_READY_TIMEOUT_MS = 3000;

/**
 * Get icon base64 from file — used for systray (mac/linux)
 */
function getIconBase64() {
  const isWin = process.platform === "win32";
  const iconFile = isWin ? "icon.ico" : "icon.png";
  try {
    const iconPath = path.join(__dirname, iconFile);
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64");
    }
  } catch (e) {}
  // Fallback: minimal green dot icon (PNG)
  return "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAHpJREFUOE9jYBgFgwEwMjIy/Gdg+P8fyP4PxP8ZGBgEcBnGyMjIsICBgSEAhyH/gfgBUNN8XJoZsdkCVL8Ah+b/QPwbqvkBMvk/AwMDAzYX/GdgYAhAN+A/SICRWAMYGfFEJSMjzriEiwDR/xmIa2RkZCSqnZERb3QCAAo3KxzxbKe1AAAAAElFTkSuQmCC";
}

/**
 * Check if system tray is supported on current OS
 * Supported: macOS, Windows, Linux (with GUI)
 */
function isTraySupported() {
  const platform = process.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  return true;
}

/**
 * Initialize system tray with menu
 * @param {Object} options - { port, onQuit, onOpenDashboard, onReady, onError }
 *   onReady/onError are optional and fire once the tray is actually usable (or
 *   provably is not). Callers must not announce a tray icon before onReady:
 *   the systray2 child can die before it ever registers one.
 * @returns {Object|null} tray instance or null if not supported/failed
 */
function initTray(options) {
  if (!isTraySupported()) {
    options.onError?.(new Error("no graphical session (DISPLAY/WAYLAND_DISPLAY unset)"));
    return null;
  }

  // Windows uses PowerShell NotifyIcon (AV-safe), others use systray
  if (process.platform === "win32") {
    return initWindowsTray(options);
  }
  return initUnixTray(options);
}

/**
 * Build menu items array shared between platforms
 */
function buildMenuItems(port, autostartEnabled) {
  return [
    { title: `9Router (Port ${port})`, tooltip: "Server is running", enabled: false },
    { title: "Open Dashboard", tooltip: "Open in browser", enabled: true },
    {
      title: autostartEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
      tooltip: "Run on OS startup",
      enabled: true
    },
    { title: "Quit", tooltip: "Stop server and exit", enabled: true }
  ];
}

// Menu item indexes
const MENU_INDEX = { STATUS: 0, DASHBOARD: 1, AUTOSTART: 2, QUIT: 3 };

/**
 * Get current autostart state
 */
function getAutostartEnabled() {
  try {
    const { isAutoStartEnabled } = require("./autostart");
    return isAutoStartEnabled();
  } catch (e) {
    return false;
  }
}

/**
 * Handle menu item click (shared logic)
 */
function handleClick(index, options, onAutostartToggle) {
  const { onQuit, onOpenDashboard, port } = options;
  if (index === MENU_INDEX.DASHBOARD) {
    if (onOpenDashboard) onOpenDashboard();
    else openBrowser(`http://localhost:${port}/dashboard`);
  } else if (index === MENU_INDEX.AUTOSTART) {
    const enabled = getAutostartEnabled();
    try {
      const { enableAutoStart, disableAutoStart } = require("./autostart");
      if (enabled) disableAutoStart();
      else enableAutoStart();
      onAutostartToggle(!enabled);
    } catch (e) {}
  } else if (index === MENU_INDEX.QUIT) {
    console.log("\n👋 Shutting down...");
    if (onQuit) onQuit();
    killTray();
    setTimeout(() => process.exit(0), 500);
  }
}

/**
 * Windows tray via PowerShell NotifyIcon
 */
function initWindowsTray(options) {
  const { port } = options;
  try {
    const { initWinTray } = require("./trayWin");
    const iconPath = path.join(__dirname, "icon.ico");
    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled);

    trayInstance = initWinTray({
      iconPath,
      tooltip: `9Router - Port ${port}`,
      items,
      onClick: (index) => {
        handleClick(index, options, (newEnabled) => {
          const newTitle = newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start";
          trayInstance.updateItem(MENU_INDEX.AUTOSTART, newTitle, true);
        });
      }
    });

    isWinTray = true;
    options.onReady?.();
    return trayInstance;
  } catch (err) {
    options.onError?.(err);
    return null;
  }
}

/**
 * macOS/Linux tray via systray binary
 *
 * Prefers `systray2`, the active fork of `systray`. Both ship only an x86_64
 * `tray_darwin_release` and select it by process.platform alone, so on Apple
 * Silicon the tray runs under Rosetta 2 and fails with EBADARCH when Rosetta is
 * absent. hooks/trayRuntime.js overlays a native arm64 build over that file to
 * avoid the dependency; the fallbacks below are Intel-only.
 *
 * Falls back to legacy `systray@1.0.5` if systray2 is unavailable, though that
 * binary's Mach-O headers are rejected by modern dyld and no icon will appear.
 */
function resolveSystray() {
  let runtimeDir = null;
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    runtimeDir = getRuntimeNodeModules();
  } catch (e) {}

  // 1) systray2 in runtime dir (where ensureTrayRuntime installs it)
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray2")).default, isV2: true }; } catch (e) {}
  }
  // 2) systray2 resolvable from the package's own node_modules / NODE_PATH
  try { return { mod: require("systray2").default, isV2: true }; } catch (e) {}
  // 3) Legacy systray fallback (unlikely to render on modern macOS)
  try { return { mod: require("systray").default, isV2: false }; } catch (e) {}
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray")).default, isV2: false }; } catch (e) {}
  }
  return null;
}

function chmodTrayBin(pkgName) {
  // systray2's npm tarball occasionally lands without +x on the bundled Go
  // binary (observed on macOS). spawn() then fails with EACCES. Best-effort
  // chmod on every init avoids a hard-to-diagnose silent tray failure.
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
    const candidates = [
      path.join(getRuntimeNodeModules(), pkgName, "traybin", binName),
      path.join(__dirname, "..", "..", "..", "node_modules", pkgName, "traybin", binName)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
  } catch (e) {}
}

/**
 * Shared libraries the tray binary needs but cannot load.
 * ldd prints "<soname> => not found" for each one.
 */
function missingSharedLibs(binPath) {
  try {
    const out = execFileSync("ldd", [binPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith("not found"))
      .map((line) => line.split(/\s+/)[0]);
  } catch (e) {
    return [];
  }
}

/**
 * Turn a dead Linux tray child into something the user can act on.
 *
 * systray2's bundled Go binary links against libappindicator3.so.1 (the Ubuntu
 * ABI). Distros that ship only the maintained libayatana fork (Arch, for one)
 * expose the same symbols under libayatana-appindicator3.so.1, so ld.so aborts
 * the child with exit 127 before it writes its handshake: systray2's ready()
 * never settles and the tray silently never appears.
 *
 * Returns null when there is nothing useful to say.
 */
function linuxTrayHint(binPath) {
  if (process.platform !== "linux" || !binPath) return null;
  const missing = missingSharedLibs(binPath);
  if (missing.length === 0) return null;

  const lines = [`  missing shared libraries: ${missing.join(", ")}`];
  if (missing.includes("libappindicator3.so.1")) {
    lines.push(
      "  Some distros (Arch, for example) ship only the libayatana fork, which is",
      "  ABI-compatible. Install your distro's libappindicator3 package, or link it:",
      "    sudo ln -s /usr/lib/libayatana-appindicator3.so.1 /usr/lib/libappindicator3.so.1"
    );
  }
  return lines.join("\n");
}

function initUnixTray(options) {
  const { port } = options;
  try {
    const resolved = resolveSystray();
    if (!resolved) return null;
    const { mod: SysTray, isV2 } = resolved;

    chmodTrayBin(isV2 ? "systray2" : "systray");

    const autostartEnabled = getAutostartEnabled();
    const items = buildMenuItems(port, autostartEnabled);

    const menu = {
      icon: getIconBase64(),
      // The bundled icon.png is a full-color RGBA logo. Don't mark it as a
      // template icon: macOS would then render it as a solid white square
      // because template mode only uses the alpha channel.
      isTemplateIcon: false,
      title: "",
      tooltip: `9Router - Port ${port}`,
      items
    };

    trayInstance = new SysTray({ menu, debug: false, copyDir: true });
    isWinTray = false;

    trayInstance.onClick((action) => {
      handleClick(action.seq_id, options, (newEnabled) => {
        trayInstance.sendAction({
          type: "update-item",
          item: {
            title: newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
            tooltip: "Run on OS startup",
            enabled: true
          },
          seq_id: MENU_INDEX.AUTOSTART
        });
      });
    });

    if (isV2) {
      // systray2 resolves ready() only once the Go child writes its single
      // handshake line to stdout. A child that dies before that (missing
      // shared library, EACCES, wrong architecture) emits no 'error' event and
      // no line, so the promise stays pending forever while the caller
      // announces a tray icon that isn't there. Bound it with a timeout.
      let settled = false;
      const reportFailure = (err) => {
        if (settled) return;
        settled = true;
        const hint = linuxTrayHint(trayInstance && trayInstance._binPath);
        options.onError?.(hint ? new Error(`${err.message}\n${hint}`) : err);
      };
      const timer = setTimeout(
        () => reportFailure(new Error(`no handshake from the tray process within ${TRAY_READY_TIMEOUT_MS}ms`)),
        TRAY_READY_TIMEOUT_MS
      );

      trayInstance
        .ready()
        .then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.onReady?.();
        })
        .catch(reportFailure);
    } else {
      trayInstance.onReady(() => options.onReady?.());
      trayInstance.onError(() => {});
    }

    return trayInstance;
  } catch (err) {
    process.stderr.write(`[9router] tray init error: ${err.message}\n`);
    options.onError?.(err);
    return null;
  }
}

/**
 * Kill tray, wait Go binary fully exit (returns Promise).
 * Critical for hide-to-tray: macOS must release NSStatusItem before bgProcess
 * spawns a new tray, otherwise the new icon silently fails to register.
 */
function killTray() {
  const instance = trayInstance;
  const wasWin = isWinTray;
  trayInstance = null;
  if (!instance) return Promise.resolve();

  if (wasWin) {
    try { instance.kill(); } catch (e) {}
    return Promise.resolve();
  }

  // Unix: get the Go tray child process handle.
  let proc = null;
  try {
    proc = instance._process || (typeof instance.process === "function" ? instance.process() : null);
  } catch (e) {}

  // Graceful shutdown: send {type:"exit"} via IPC so the Go binary can call
  // systray.Quit() and release NSStatusItem. SIGKILL leaves a ghost icon on
  // the macOS menubar until logout, causing duplicate icons after re-spawn.
  const gracefulQuit = () => { try { instance.kill(true); } catch (e) {} };
  const closeIpc = () => { try { instance.kill(false); } catch (e) {} };

  if (!proc || !proc.pid) {
    gracefulQuit();
    closeIpc();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; closeIpc(); resolve(); };

    proc.once("exit", finish);
    gracefulQuit();

    // Escalate: SIGTERM after 800ms, SIGKILL after 1600ms if still alive.
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGTERM"); } catch (e) {} }, 800);
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGKILL"); } catch (e) {} }, 1600);

    // Fallback poll in case "exit" never fires (detached child, pipe closed)
    const deadline = Date.now() + 3000;
    const poll = setInterval(() => {
      try { process.kill(proc.pid, 0); } catch { clearInterval(poll); finish(); return; }
      if (Date.now() > deadline) { clearInterval(poll); finish(); }
    }, 50);
  });
}

/**
 * Open browser
 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd);
}

module.exports = {
  initTray,
  killTray
};
