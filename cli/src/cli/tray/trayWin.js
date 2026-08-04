const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");

// PowerShell-based tray for Windows (AV-safe, zero binary deps)

// This is only an identity pointer.  Every controller below closes over its
// own child and timer, so an old controller can never kill a newly-created
// tray process after a delayed shutdown callback fires.
let activeTray = null;

/**
 * Initialize Windows tray using PowerShell NotifyIcon
 * @param {Object} options - { iconPath, tooltip, items, onClick }
 *   items: [{ title, enabled }]
 * @returns {Object|null} controller with sendAction/kill
 */
function initWinTray(options) {
  const { iconPath, tooltip, items, onClick } = options;
  const scriptPath = path.join(__dirname, "tray.ps1");
  let psProcess;

  try {
    psProcess = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-InputFormat", "Text",
        "-OutputFormat", "Text",
        "-File", scriptPath,
        "-IconPath", iconPath,
        "-Tooltip", tooltip
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    return null;
  }

  let closed = false;
  let forceKillTimer = null;
  let resolveKilled = null;
  let killPromise = null;

  const rl = readline.createInterface({ input: psProcess.stdout });
  const isActive = () => activeTray && activeTray.process === psProcess;
  const clearProcess = () => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
    try { rl.close(); } catch { /* already closed */ }
    if (isActive()) activeTray = null;
    if (resolveKilled) {
      const resolve = resolveKilled;
      resolveKilled = null;
      resolve();
    }
  };

  const sendCommand = (cmd) => {
    if (closed || !psProcess.stdin || !psProcess.stdin.writable) return false;
    try {
      psProcess.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  };

  rl.on("line", (line) => {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "click" && typeof onClick === "function") {
        onClick(evt.index);
      }
    } catch (e) {}
  });

  // Streams can report EPIPE asynchronously after a graceful quit.  Consume
  // those errors so they cannot become an uncaught exception in tray mode.
  psProcess.on("error", clearProcess);
  psProcess.on("exit", clearProcess);
  psProcess.stdin?.on("error", () => {});
  psProcess.stderr?.on("data", () => {});

  const controller = {
    process: psProcess,
    updateItem(index, title, enabled) {
      return sendCommand({ action: "update-item", index, title, enabled });
    },
    setTooltip(text) {
      return sendCommand({ action: "set-tooltip", text });
    },
    kill() {
      if (killPromise) return killPromise;
      closed = true;
      // Write before marking the process as closed.  A `kill` command lets
      // NotifyIcon dispose itself cleanly; the direct child kill below is only
      // a bounded fallback for a hung PowerShell process.
      try {
        if (psProcess.stdin?.writable) {
          psProcess.stdin.write(`${JSON.stringify({ action: "kill" })}\n`, "utf8");
        }
      } catch { /* direct fallback below */ }

      killPromise = new Promise((resolve) => {
        resolveKilled = resolve;
        forceKillTimer = setTimeout(() => {
          // Capture `psProcess` in this controller's closure.  Do not consult
          // a mutable global here: an old timer must never terminate a newer
          // tray instance created during hand-off.
          if (psProcess.exitCode === null || psProcess.exitCode === undefined) {
            try { psProcess.kill(); } catch { /* already gone */ }
          }
          clearProcess();
        }, 750);
        if (typeof forceKillTimer.unref === "function") forceKillTimer.unref();
      });

      return killPromise;
    }
  };

  // Replace an existing tray deliberately.  Its timer is tied to the old
  // child, and this new controller becomes the sole active tray immediately.
  const previous = activeTray;
  activeTray = controller;
  if (previous) void previous.kill();

  // Send initial menu items
  items.forEach((item, index) => {
    sendCommand({ action: "add-item", index, title: item.title, enabled: item.enabled });
  });

  return controller;
}

module.exports = { initWinTray };
