// Ensure better-sqlite3 is installed in USER_DATA_DIR/runtime/node_modules
// (user-writable, avoids Windows EBUSY locks during npm i -g updates).
// sql.js is bundled in bin/app already; node:sqlite / bun:sqlite are built-in.
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BETTER_SQLITE3_VERSION = "12.6.2";

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

  // Minimal package.json so npm treats it as a project root
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: "9router-runtime",
      version: "1.0.0",
      private: true,
      description: "User-writable runtime deps for 9router (better-sqlite3 native binary)",
    }, null, 2));
  }
  return dir;
}

function hasModule(name) {
  return fs.existsSync(path.join(getRuntimeNodeModules(), name, "package.json"));
}

function isBetterSqliteBinaryValid() {
  const binary = path.join(getRuntimeNodeModules(), "better-sqlite3", "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(binary)) return false;
  try {
    const fd = fs.openSync(binary, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (process.platform === "linux") return magic.startsWith("7f454c46");
    if (process.platform === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    if (process.platform === "win32") return magic.startsWith("4d5a");
    return true;
  } catch { return false; }
}

function npmInstall(pkgs, opts = {}) {
  const cwd = ensureRuntimeDir();
  const args = ["install", ...pkgs, "--no-audit", "--no-fund", "--prefer-online"];
  if (opts.optional) args.push("--no-save");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log(`[9router][runtime] ${npmCmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(npmCmd, args, {
    cwd,
    stdio: opts.silent ? "ignore" : "inherit",
    timeout: opts.timeout || 180000,
    shell: process.platform === "win32",
  });
  return res.status === 0;
}

// Public: ensure better-sqlite3 native module is installed in user-writable
// runtime dir. sql.js is bundled in bin/app already; node:sqlite is built-in.
// This is purely a *speed optimization* — app works without it via fallbacks.
function ensureSqliteRuntime({ silent = false } = {}) {
  ensureRuntimeDir();

  const needBetterSqlite = !hasModule("better-sqlite3") || !isBetterSqliteBinaryValid();
  if (!needBetterSqlite) {
    if (!silent) console.log("[9router][runtime] better-sqlite3 OK");
    return { betterSqlite: true };
  }

  const ok = npmInstall([`better-sqlite3@${BETTER_SQLITE3_VERSION}`], { optional: true, silent });
  if (!ok && !silent) {
    console.warn("[9router][runtime] better-sqlite3 install failed (will use node:sqlite or sql.js fallback)");
  }
  return {
    betterSqlite: ok && hasModule("better-sqlite3") && isBetterSqliteBinaryValid(),
  };
}

// Inject runtime + bundled node_modules into NODE_PATH so child Node processes
// resolve sql.js (bundled in bin/app/node_modules) and better-sqlite3 (runtime).
function buildEnvWithRuntime(baseEnv = process.env) {
  const runtimeNm = getRuntimeNodeModules();
  const bundledNm = path.join(__dirname, "..", "app", "node_modules");
  const existing = baseEnv.NODE_PATH || "";
  const NODE_PATH = [runtimeNm, bundledNm, existing].filter(Boolean).join(path.delimiter);
  return { ...baseEnv, NODE_PATH };
}

module.exports = {
  ensureSqliteRuntime,
  buildEnvWithRuntime,
  getRuntimeDir,
  getRuntimeNodeModules,
};
