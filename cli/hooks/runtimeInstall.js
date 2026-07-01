// Shared runtime install helper.
//
// Owns the user-writable runtime directory under DATA_DIR (or the platform
// default), the npm install wrapper, and the package-specific install logging
// used by cli/hooks/sqliteRuntime.js and cli/hooks/trayRuntime.js.
//
// Keeping a single install wrapper ensures the --no-save flag is never passed
// for runtime installs: each install writes to package.json dependencies, so
// later installs no longer treat earlier runtime packages as extraneous and
// do not prune them.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "9router")
    : path.join(os.homedir(), ".9router");
}

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), "node_modules");
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    // Minimal package.json so npm treats this as a project root and writes
    // installed packages under dependencies. npm will add the dependencies
    // key automatically on the first saved install.
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable runtime deps for 9router (better-sqlite3 native binary)",
    }, null, 2));
  }

  return dir;
}

function summarizeNpmError(stderr = "") {
  const text = String(stderr);
  if (/ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network|getaddrinfo/i.test(text)) return "No internet connection or registry unreachable";
  if (/EACCES|EPERM|permission denied/i.test(text)) return "Permission denied (check folder permissions)";
  if (/ENOSPC|no space/i.test(text)) return "Not enough disk space";
  if (/node-gyp|gyp ERR|python|MSBuild|Visual Studio|Xcode/i.test(text)) return "Missing build tools (Xcode CLT / Python / VS Build Tools)";
  if (/ETARGET|version.*not found/i.test(text)) return "Package version not found on registry";
  const m = text.match(/npm ERR! (.+)/);
  if (m) return m[1].slice(0, 200);
  const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
  return lastLine ? lastLine.slice(0, 200) : "Unknown error";
}

function runNpmInstall({ cwd, pkgs, extraArgs = [], timeout = 180000 }) {
  const args = ["install", ...pkgs, "--no-audit", "--no-fund", "--prefer-online", ...extraArgs];
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npmCmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  return { ok: res.status === 0, code: res.status, stderr: res.stderr || "", stdout: res.stdout || "" };
}

function installRuntimePackages(pkgs, {
  silent = false,
  timeout = 180000,
  label = "runtime package",
  failureTitle = "Runtime package install failed",
  failureHint = "runtime dependency unavailable",
} = {}) {
  const cwd = ensureRuntimeDir();
  if (!silent) console.log(`⏳ Installing ${label} (first run)...`);

  const res = runNpmInstall({ cwd, pkgs, timeout });
  if (!res.ok && !silent) {
    const reason = summarizeNpmError(res.stderr);
    console.warn(`⚠️  ${failureTitle}`);
    console.warn(`   Reason: ${reason}`);
    console.warn(`   Retry:  cd "${cwd}" && npm install ${pkgs.join(" ")}`);
    console.warn(`   Result: ${failureHint}`);
  }

  return res.ok;
}

module.exports = {
  ensureRuntimeDir,
  getDataDir,
  getRuntimeDir,
  getRuntimeNodeModules,
  installRuntimePackages,
  runNpmInstall,
  summarizeNpmError,
};
