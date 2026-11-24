// Decide whether a process belongs to THIS 9router install before killing it.
//
// Every Next.js server renames its process title to "next-server (vX.Y.Z)", so matching that
// string alone kills unrelated Next.js apps on the same machine. A process is ours only when it
// runs from our app directory: its working directory on Linux/macOS (Next's standalone server
// chdirs into it), its command line on Windows (WMI reports the script path there). When the
// owner cannot be established the answer is "not ours": the app port is still freed by
// killProcessOnPort, so leaving a stranger alone never blocks startup.
//
// Keep in sync with src/lib/ownedProcess.js (the app bundle cannot require the CLI package).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function processCwd(pid) {
  if (process.platform === "linux") {
    try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
  }
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    });
    const line = out.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function normalizeWin(p) {
  return String(p || "").replace(/\//g, "\\").toLowerCase();
}

// pid: process id; appDir: this install's app directory; commandLine: WMI CommandLine (Windows)
function processRunsFrom(pid, appDir, { commandLine = "", platform = process.platform } = {}) {
  if (!pid || !appDir) return false;
  if (platform === "win32") {
    // WMI reports absolute paths, and __dirname / process.cwd() are absolute: compare as given.
    const want = normalizeWin(appDir).replace(/\\+$/, "");
    return !!want && normalizeWin(commandLine).includes(want);
  }
  const cwd = processCwd(pid);
  if (!cwd) return false;
  return isInside(realOrResolved(cwd), realOrResolved(appDir));
}

module.exports = { processRunsFrom, isInside };
