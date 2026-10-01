import fs from "fs";
import path from "path";
import { spawn, execSync, execFileSync } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";

export const PXPIPE_DIR = path.join(DATA_DIR, "pxpipe");
export const PXPIPE_PACKAGE = "pxpipe-proxy";
const INSTALL_LOG = path.join(PXPIPE_DIR, "install.log");
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const IS_WIN = process.platform === "win32";

// Windows: never invoke npm.cmd via a shell (args+shell is an injection risk
// and direct spawn of .cmd throws EINVAL on Node ≥22.12). Primary remains the
// npm CLI that ships beside this runtime: <execPath dir>/node_modules/npm/bin/npm-cli.js.
// If missing (e.g. bun.exe launch), fall back to locating node.exe via the
// absolute System32 where.exe and verifying each candidate ships npm-cli.js.
export function resolveNpmInvocation(
  nodeExecutable = process.execPath,
  stat = (p) => fs.statSync(p),
  findNodeCandidates = defaultFindNodeCandidates,
) {
  const cliBeside = (exe) => path.join(path.dirname(exe), "node_modules", "npm", "bin", "npm-cli.js");
  const isFile = (p) => {
    try {
      return stat(p).isFile();
    } catch {
      return false;
    }
  };

  // Primary: adjacent to this runtime's executable (trusted layout).
  const primaryCli = cliBeside(nodeExecutable);
  if (isFile(primaryCli)) return { command: nodeExecutable, args: [primaryCli] };

  // Fallback: verify each located candidate is itself a file AND ships an
  // adjacent npm-cli.js. Never trust .cmd/.bat shims; argv stays discrete.
  let candidates;
  try {
    candidates = findNodeCandidates();
  } catch {
    return null;
  }
  for (const cand of Array.isArray(candidates) ? candidates : []) {
    if (!cand || !isFile(cand)) continue;
    const cli = cliBeside(cand);
    if (isFile(cli)) return { command: cand, args: [cli] };
  }
  return null;
}

function defaultFindNodeCandidates() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) return null;
  const whereExe = path.join(systemRoot, "System32", "where.exe");
  let out = "";
  try {
    out = execFileSync(whereExe, ["node.exe"], {
      windowsHide: true,
      shell: false,
      encoding: "utf8",
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
  } catch {
    return null;
  }
  return String(out)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

// Bounded diagnostic code: only safe charset survives to errors/log.
function diagCode(raw, fallback) {
  return /^[A-Z0-9_-]{1,40}$/.test(String(raw || "")) ? String(raw) : fallback;
}

// Fixed-text log writer; never lets its own failure escape.
function writeDiag(outFd, line) {
  try {
    fs.writeSync(outFd, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

async function runInstall() {
  // Windows: resolve the trusted npm-cli beside this Node binary — never trust
  // `where npm` for the invocation. Unix: direct command with shell:false.
  let invocation;
  if (IS_WIN) {
    invocation = resolveNpmInvocation();
    if (!invocation) {
      const err = new Error("npm-cli.js not found beside Node — Node.js/npm is required to install PXPIPE");
      err.code = "NPM_NOT_FOUND";
      throw err;
    }
  } else {
    const npm = findNpm();
    if (!npm) {
      const err = new Error("npm not found on PATH — Node.js/npm is required to install PXPIPE");
      err.code = "NPM_NOT_FOUND";
      throw err;
    }
    invocation = { command: npm, args: [] };
  }
  const INSTALL_ARGS = ["install", `${PXPIPE_PACKAGE}@latest`, "--no-audit", "--no-fund", "--omit=dev"];

  ensureDir();
  const pkgJson = path.join(PXPIPE_DIR, "package.json");
  if (!fs.existsSync(pkgJson)) {
    fs.writeFileSync(pkgJson, JSON.stringify({ name: "9router-pxpipe-host", private: true }, null, 2));
  }

  let timer;
  let outFd;
  try {
    outFd = fs.openSync(INSTALL_LOG, "a");
    writeDiag(outFd, `npm install ${PXPIPE_PACKAGE}@latest`);

    await new Promise((resolve, reject) => {
      // settle-once guard: async error/exit/timeout races must not double-settle.
      // Handlers check it BEFORE writing diagnostics so late events stay silent.
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      let child;
      try {
        child = spawn(invocation.command, [...invocation.args, ...INSTALL_ARGS], {
          cwd: PXPIPE_DIR,
          stdio: ["ignore", outFd, outFd],
          windowsHide: true,
          shell: false,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
      } catch (e) {
        if (settled) return;
        const code = diagCode(e?.code, "ERROR");
        writeDiag(outFd, `spawn failed: ${code}`);
        const err = new Error(`npm install failed: ${code} — see install.log`);
        err.code = e?.code === code ? e.code : code;
        return settle(reject, err);
      }
      timer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGKILL");
        } catch {}
        writeDiag(outFd, "npm install timed out after 5 minutes — see install.log");
        const err = new Error("npm install timed out after 5 minutes — see install.log");
        err.code = "INSTALL_TIMEOUT";
        settle(reject, err);
      }, INSTALL_TIMEOUT_MS);
      child.once("error", (e) => {
        if (settled) return;
        const code = diagCode(e?.code, "ERROR");
        writeDiag(outFd, `spawn error: ${code}`);
        const err = new Error(`npm install failed: ${code} — see install.log`);
        err.code = e?.code === code ? e.code : code;
        settle(reject, err);
      });
      child.once("exit", (exitCode, signal) => {
        if (settled) return;
        if (signal && exitCode == null) {
          // Killed by signal: bounded diagnostic must reflect the signal, not exit 0.
          const safe = diagCode(signal, null);
          const code = safe ? `INSTALL_SIGNAL_${safe}` : "INSTALL_FAILED";
          writeDiag(outFd, `npm install exited with signal ${safe || "UNKNOWN"} — see install.log`);
          const err = new Error(`npm install terminated by ${safe ? `signal ${safe}` : "unknown signal"} — see install.log`);
          err.code = code;
          return settle(reject, err);
        }
        if (exitCode !== 0) {
          writeDiag(outFd, `npm install exited with exit code ${Number(exitCode)} — see install.log`);
          const err = new Error(`npm install exited with code ${Number(exitCode)} — see install.log`);
          err.code = diagCode(`INSTALL_EXIT_${Number(exitCode)}`, "INSTALL_FAILED");
          return settle(reject, err);
        }
        settle(resolve);
      });
    });

    const info = getInstallInfo();
    if (!info.installed) throw new Error("install finished but package is missing — see install.log");
    return info;
  } finally {
    if (outFd !== undefined && outFd !== null) {
      clearTimeout(timer);
      try {
        fs.closeSync(outFd);
      } catch {}
      outFd = null;
    }
  }
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
