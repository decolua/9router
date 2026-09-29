const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;
let isWinTray = false;

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
 * @param {Object} options - { port, onQuit, onOpenDashboard }
 * @returns {Object|null} tray instance or null if not supported/failed
 */
function initTray(options) {
  if (!isTraySupported()) {
    return null;
  }

  configureTrayApi(options?.port);

  // Windows uses PowerShell NotifyIcon (AV-safe), others use systray
  if (process.platform === "win32") {
    // Await settings before first paint so RTK label matches dashboard (no race).
    initWindowsTray(options).catch(() => {});
    return null;
  }
  initUnixTray(options).catch(() => {});
  return null;
}

function autostartMenuTitle(enabled) {
  return enabled ? "✓ Auto-start Enabled" : "Enable Auto-start";
}

function rtkMenuTitle(enabled) {
  return enabled ? "✓ RTK Enabled" : "Enable RTK";
}

function headroomMenuTitle(enabled) {
  return enabled ? "✓ Headroom Enabled" : "Enable Headroom";
}

function cavemanMenuTitle(enabled) {
  return enabled ? "✓ Caveman Enabled" : "Enable Caveman";
}

function ponytailMenuTitle(enabled) {
  return enabled ? "✓ Ponytail Enabled" : "Enable Ponytail";
}

/** @typedef {{ rtk?: boolean, headroom?: boolean, caveman?: boolean, ponytail?: boolean }} TokenSaverFlags */

/**
 * Build menu items array shared between platforms.
 * Third arg: TokenSaverFlags object, or legacy boolean = rtk only.
 */
function buildMenuItems(port, autostartEnabled, tokenSaver = true) {
  const flags = typeof tokenSaver === "boolean"
    ? { rtk: tokenSaver, headroom: false, caveman: false, ponytail: false }
    : {
      rtk: tokenSaver?.rtk !== false,
      headroom: !!tokenSaver?.headroom,
      caveman: !!tokenSaver?.caveman,
      ponytail: !!tokenSaver?.ponytail
    };

  return [
    { title: `9Router (Port ${port})`, tooltip: "Server is running", enabled: false },
    { title: "Open Dashboard", tooltip: "Open in browser", enabled: true },
    {
      title: autostartMenuTitle(autostartEnabled),
      tooltip: "Run on OS startup",
      enabled: true
    },
    {
      title: rtkMenuTitle(flags.rtk),
      tooltip: "Token Saver — compress tool results",
      enabled: true
    },
    {
      title: headroomMenuTitle(flags.headroom),
      tooltip: "Token Saver — compress context via Headroom",
      enabled: true
    },
    {
      title: cavemanMenuTitle(flags.caveman),
      tooltip: "Token Saver — terse LLM output style",
      enabled: true
    },
    {
      title: ponytailMenuTitle(flags.ponytail),
      tooltip: "Token Saver — minimal-code bias",
      enabled: true
    },
    { title: "Quit", tooltip: "Stop server and exit", enabled: true }
  ];
}

// Menu item indexes
const MENU_INDEX = {
  STATUS: 0,
  DASHBOARD: 1,
  AUTOSTART: 2,
  RTK: 3,
  HEADROOM: 4,
  CAVEMAN: 5,
  PONYTAIL: 6,
  QUIT: 7
};

const TOKEN_SAVER_DEFS = {
  rtk: {
    index: MENU_INDEX.RTK,
    settingKey: "rtkEnabled",
    titleFn: rtkMenuTitle,
    tooltip: "Token Saver — compress tool results",
    read: (d) => d?.rtkEnabled !== false,
    defaultOn: true
  },
  headroom: {
    index: MENU_INDEX.HEADROOM,
    settingKey: "headroomEnabled",
    titleFn: headroomMenuTitle,
    tooltip: "Token Saver — compress context via Headroom",
    read: (d) => !!d?.headroomEnabled,
    defaultOn: false
  },
  caveman: {
    index: MENU_INDEX.CAVEMAN,
    settingKey: "cavemanEnabled",
    titleFn: cavemanMenuTitle,
    tooltip: "Token Saver — terse LLM output style",
    read: (d) => !!d?.cavemanEnabled,
    defaultOn: false
  },
  ponytail: {
    index: MENU_INDEX.PONYTAIL,
    settingKey: "ponytailEnabled",
    titleFn: ponytailMenuTitle,
    tooltip: "Token Saver — minimal-code bias",
    read: (d) => !!d?.ponytailEnabled,
    defaultOn: false
  }
};

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

function configureTrayApi(port) {
  try {
    const api = require("../api/client");
    api.configure({ host: "127.0.0.1", port: port || 20128 });
  } catch (e) {}
}

/** @type {TokenSaverFlags} */
let lastTokenSaver = {
  rtk: null,
  headroom: null,
  caveman: null,
  ponytail: null
};

function defaultTokenSaverFlags() {
  return {
    rtk: lastTokenSaver.rtk !== null ? lastTokenSaver.rtk : true,
    headroom: lastTokenSaver.headroom !== null ? lastTokenSaver.headroom : false,
    caveman: lastTokenSaver.caveman !== null ? lastTokenSaver.caveman : false,
    ponytail: lastTokenSaver.ponytail !== null ? lastTokenSaver.ponytail : false
  };
}

/**
 * Read all Token Saver flags from live settings API.
 */
async function getTokenSaverFlags() {
  try {
    const api = require("../api/client");
    const res = await api.getSettings();
    if (res?.success) {
      lastTokenSaver = {
        rtk: TOKEN_SAVER_DEFS.rtk.read(res.data),
        headroom: TOKEN_SAVER_DEFS.headroom.read(res.data),
        caveman: TOKEN_SAVER_DEFS.caveman.read(res.data),
        ponytail: TOKEN_SAVER_DEFS.ponytail.read(res.data)
      };
      return { ...lastTokenSaver };
    }
  } catch (e) {}
  return defaultTokenSaverFlags();
}

/** @deprecated use getTokenSaverFlags — kept for tests */
async function getRtkEnabled() {
  const flags = await getTokenSaverFlags();
  return flags.rtk;
}

/**
 * Toggle one Token Saver flag. Returns new enabled state, or null on failure.
 */
async function toggleTokenSaverFlag(kind, currentlyOn) {
  const def = TOKEN_SAVER_DEFS[kind];
  if (!def) return null;
  try {
    const api = require("../api/client");
    const next = !currentlyOn;
    const res = await api.updateSettings({ [def.settingKey]: next });
    if (res?.success) {
      const enabled = def.read(res.data);
      lastTokenSaver[kind] = enabled;
      return enabled;
    }
  } catch (e) {}
  return null;
}

function updateTokenSaverItem(kind, enabled) {
  if (!trayInstance) return;
  const def = TOKEN_SAVER_DEFS[kind];
  if (!def) return;
  const title = def.titleFn(enabled);
  if (isWinTray && typeof trayInstance.updateItem === "function") {
    trayInstance.updateItem(def.index, title, true);
  } else if (typeof trayInstance.sendAction === "function") {
    trayInstance.sendAction({
      type: "update-item",
      item: { title, tooltip: def.tooltip, enabled: true },
      seq_id: def.index
    });
  }
}

function applyTokenSaverFlagsToMenu(flags) {
  for (const kind of Object.keys(TOKEN_SAVER_DEFS)) {
    updateTokenSaverItem(kind, !!flags[kind]);
  }
}

/**
 * Re-read settings and update all Token Saver menu labels.
 */
function refreshTokenSaverMenuLabels() {
  getTokenSaverFlags().then((flags) => {
    if (!trayInstance) return;
    applyTokenSaverFlagsToMenu(flags);
  }).catch(() => {});
}

let tokenSaverPollTimer = null;

function startTokenSaverPoll() {
  if (tokenSaverPollTimer) return;
  tokenSaverPollTimer = setInterval(() => refreshTokenSaverMenuLabels(), 1500);
  if (typeof tokenSaverPollTimer.unref === "function") tokenSaverPollTimer.unref();
}

function stopTokenSaverPoll() {
  if (tokenSaverPollTimer) {
    clearInterval(tokenSaverPollTimer);
    tokenSaverPollTimer = null;
  }
}

function handleTokenSaverClick(kind) {
  (async () => {
    const cached = lastTokenSaver[kind];
    const enabled = cached !== null && cached !== undefined
      ? cached
      : (await getTokenSaverFlags())[kind];
    const optimistic = !enabled;
    updateTokenSaverItem(kind, optimistic);
    lastTokenSaver[kind] = optimistic;
    const next = await toggleTokenSaverFlag(kind, enabled);
    if (next === null) {
      lastTokenSaver[kind] = enabled;
      updateTokenSaverItem(kind, enabled);
    } else {
      updateTokenSaverItem(kind, next);
    }
  })().catch(() => {});
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
  } else if (index === MENU_INDEX.RTK) {
    handleTokenSaverClick("rtk");
  } else if (index === MENU_INDEX.HEADROOM) {
    handleTokenSaverClick("headroom");
  } else if (index === MENU_INDEX.CAVEMAN) {
    handleTokenSaverClick("caveman");
  } else if (index === MENU_INDEX.PONYTAIL) {
    handleTokenSaverClick("ponytail");
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
async function initWindowsTray(options) {
  const { port } = options;
  try {
    const { initWinTray } = require("./trayWin");
    const iconPath = path.join(__dirname, "icon.ico");
    const autostartEnabled = getAutostartEnabled();
    const tokenSaver = await getTokenSaverFlags();
    const items = buildMenuItems(port, autostartEnabled, tokenSaver);

    trayInstance = initWinTray({
      iconPath,
      tooltip: `9Router - Port ${port}`,
      items,
      onClick: (index) => {
        handleClick(index, options, (newEnabled) => {
          trayInstance.updateItem(MENU_INDEX.AUTOSTART, autostartMenuTitle(newEnabled), true);
        });
      },
      onMenuOpen: () => refreshTokenSaverMenuLabels()
    });

    isWinTray = true;
    startTokenSaverPoll();
    return trayInstance;
  } catch (err) {
    return null;
  }
}

/**
 * macOS/Linux tray via systray binary
 *
 * Prefers `systray2` (active fork of `systray`, ships newer
 * getlantern/systray-portable binaries that work on macOS 14+ and Apple
 * Silicon under Rosetta). Falls back to legacy `systray@1.0.5` if systray2
 * is not available, though that binary's Mach-O headers are rejected by
 * modern dyld and the icon will not appear.
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

async function initUnixTray(options) {
  const { port } = options;
  try {
    const resolved = resolveSystray();
    if (!resolved) return null;
    const { mod: SysTray, isV2 } = resolved;

    chmodTrayBin(isV2 ? "systray2" : "systray");

    const autostartEnabled = getAutostartEnabled();
    const tokenSaver = await getTokenSaverFlags();
    const items = buildMenuItems(port, autostartEnabled, tokenSaver);

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
            title: autostartMenuTitle(newEnabled),
            tooltip: "Run on OS startup",
            enabled: true
          },
          seq_id: MENU_INDEX.AUTOSTART
        });
      });
    });

    if (isV2) {
      // systray2 exposes a ready() promise instead of onReady/onError. Surface
      // failures (binary crash, EACCES, etc.) so users can see why the icon
      // didn't appear instead of getting a misleading "running in tray" log.
      trayInstance.ready().catch((err) => {
        process.stderr.write(`[9router] tray failed to start: ${err && err.message ? err.message : err}\n`);
      });
    } else {
      trayInstance.onReady(() => {});
      trayInstance.onError(() => {});
    }

    refreshTokenSaverMenuLabels();
    startTokenSaverPoll();
    return trayInstance;
  } catch (err) {
    process.stderr.write(`[9router] tray init error: ${err.message}\n`);
    return null;
  }
}

/**
 * Kill tray, wait Go binary fully exit (returns Promise).
 * Critical for hide-to-tray: macOS must release NSStatusItem before bgProcess
 * spawns a new tray, otherwise the new icon silently fails to register.
 */
function killTray() {
  stopTokenSaverPoll();
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
  killTray,
  buildMenuItems,
  MENU_INDEX,
  rtkMenuTitle,
  headroomMenuTitle,
  cavemanMenuTitle,
  ponytailMenuTitle,
  autostartMenuTitle,
  getRtkEnabled,
  getTokenSaverFlags
};
