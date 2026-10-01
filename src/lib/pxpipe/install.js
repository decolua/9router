import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
export const PXPIPE_PACKAGE = "pxpipe-proxy";
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const IS_WIN = process.platform === "win32";
const NPM_CMD = IS_WIN ? "npm.cmd" : "npm";

// Same PATH extension trick as headroom/detect.js: packaged/launchd environments
// often miss the Node bin dirs.
const EXTRA_BINS = IS_WIN
  ? [`${process.env.ProgramFiles || ""}\\nodejs`, `${process.env.APPDATA || ""}\\npm`]
  : ["/usr/local/bin", "/opt/homebrew/bin", `${process.env.HOME || ""}/.local/bin`, "/usr/bin", "/bin"];
const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);

let installInFlight = null;

function ensureDir() {
  if (!fs.existsSync(PXPIPE_DIR)) fs.mkdirSync(PXPIPE_DIR, { recursive: true });
}

export function packageRoot() {
  return path.join(PXPIPE_DIR, "node_modules", PXPIPE_PACKAGE);
}

export function libraryEntry() {
  return path.join(packageRoot(), "dist", "core", "library.js");
}

export function findNpm() {
  try {
    const out = execSync(`${IS_WIN ? "where" : "which"} npm`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
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
  const npm = findNpm();
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
    const child = spawn(npm, ["install", `${PXPIPE_PACKAGE}@latest`, "--no-audit", "--no-fund", "--omit=dev"], {
      cwd: PXPIPE_DIR,
      stdio: ["ignore", outFd, outFd],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("npm install timed out after 5 minutes — see install.log"));
    }, INSTALL_TIMEOUT_MS);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code} — see install.log`));
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
