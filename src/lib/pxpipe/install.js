import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
export const PXPIPE_PACKAGE = "pxpipe-proxy";
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const NPM_PROBE_TTL_MS = 30_000;

const IS_WIN = process.platform === "win32";

// Same PATH extension trick as headroom/detect.js: packaged/launchd environments
// often miss the Node bin dirs.
const EXTRA_BINS = IS_WIN
  ? [`${process.env.ProgramFiles || ""}\\nodejs`, `${process.env.APPDATA || ""}\\npm`]
  : ["/usr/local/bin", "/opt/homebrew/bin", `${process.env.HOME || ""}/.local/bin`, "/usr/bin", "/bin"];
const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

let installInFlight = null;
let npmInvocationCache = { value: undefined, checkedAt: 0 };

function ensureDir() {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true });
}

export function packageRoot() {
  return path.join(PXPIPE_DIR, "node_modules", PXPIPE_PACKAGE);
}

export function libraryEntry() {
  return path.join(packageRoot(), "dist", "core", "library.js");
}

function getNpmInvocation() {
  const now = Date.now();
  if (npmInvocationCache.value !== undefined && now - npmInvocationCache.checkedAt < NPM_PROBE_TTL_MS) {
    return npmInvocationCache.value;
  }

  let invocation = null;
  try {
    if (IS_WIN) {
      // npm.cmd requires cmd.exe, even with windowsHide. Run npm's JavaScript
      // entry through a known Node executable so status checks and installs
      // never create a cmd/console child.
      const nodeCandidates = [process.execPath];
      try {
        const discovered = execFileSync("where.exe", ["node.exe"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          env: { ...process.env, PATH: EXTENDED_PATH },
          timeout: 2_000,
        }).trim().split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        nodeCandidates.push(...discovered);
      } catch { /* process.execPath remains the primary candidate */ }

      for (const nodePath of [...new Set(nodeCandidates)]) {
        const npmCli = path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
        if (fs.existsSync(npmCli)) {
          invocation = { command: nodePath, prefixArgs: [npmCli] };
          break;
        }
      }
    } else {
      const npm = execFileSync("which", ["npm"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: EXTENDED_PATH },
        timeout: 2_000,
      }).trim().split(/\r?\n/)[0];
      if (npm) invocation = { command: npm, prefixArgs: [] };
    }
  } catch { /* reported as unavailable by callers */ }

  npmInvocationCache = { value: invocation, checkedAt: now };
  return invocation;
}

export function findNpm() {
  return getNpmInvocation()?.command || null;
}

// { installed, version, path } — installed means the library entry exists on disk.
export function getInstallInfo() {
  try {
    const pkgJson = path.join(packageRoot(), "package.json");
    if (!fs.existsSync(pkgJson) || !fs.existsSync(libraryEntry())) {
      return { installed: false, version: null, path: null };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
    return { installed: true, version: pkg.version || null, path: packageRoot() };
  } catch {
    return { installed: false, version: null, path: null };
  }
}

export function isInstalling() {
  return installInFlight !== null;
}

// Install (or repair by reinstalling) pxpipe-proxy into DATA_DIR/pxpipe.
// Serialized: concurrent calls await the same run.
export function installPxpipe() {
  if (installInFlight) return installInFlight;
  installInFlight = runInstall().finally(() => { installInFlight = null; });
  return installInFlight;
}

async function runInstall() {
  const npm = getNpmInvocation();
  if (!npm) {
    const err = new Error("npm not found on PATH — Node.js/npm is required to install PXPIPE");
    err.code = "NPM_NOT_FOUND";
    throw err;
  }

  ensureDir();
  const pkgJson = path.join(PXPIPE_DIR, "package.json");
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: "9router-pxpipe-host", private: true }, null, 2));
  }

  const outFd = fs.openSync(INSTALL_LOG, "a");
  fs.writeSync(outFd, `\n[${new Date().toISOString()}] npm install ${PXPIPE_PACKAGE}@latest\n`);

  await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const child = spawn(npm.command, [...npm.prefixArgs, "install", `${PXPIPE_PACKAGE}@latest`, "--no-audit", "--no-fund", "--omit=dev"], {
      cwd: PXPIPE_DIR,
      stdio: ["ignore", outFd, outFd],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    timer = setTimeout(() => {
      try {
        if (IS_WIN && child.pid) {
          execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
            timeout: 5_000,
          });
        } else {
          child.kill("SIGKILL");
        }
      } catch { /* exit handler will also settle if it wins the race */ }
      finish(new Error("npm install timed out after 5 minutes — see install.log"));
    }, INSTALL_TIMEOUT_MS);
    child.once("error", finish);
    child.once("exit", (code) => {
      if (code === 0) finish();
      else finish(new Error(`npm install exited with code ${code} — see install.log`));
    });
  }).finally(() => fs.closeSync(outFd));

  const info = getInstallInfo();
  if (!info.installed) throw new Error("install finished but package is missing — see install.log");
  return info;
}

export function getInstallLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(INSTALL_LOG)) return "";
    const lines = fs.readFileSync(INSTALL_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
