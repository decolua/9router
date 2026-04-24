import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import { execWithPassword } from "@/mitm/dns/dnsConfig";
import { saveTailscalePid, clearTailscalePid } from "./state";
import { DATA_DIR } from "@/lib/dataDir";

const BIN_DIR = path.join(DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, "tailscaled.sock");
const SOCKET_FLAG = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Prefer system tailscale, fallback to local bin, then Windows default path
function getTailscaleBin(): string | null {
  try {
    const systemPath = execSync("which tailscale 2>/dev/null || where tailscale 2>nul", { encoding: "utf8", windowsHide: true }).trim();
    if (systemPath) return systemPath;
  } catch (e) { /* not in PATH */ }
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  return null;
}

export function isTailscaleInstalled(): boolean {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args: string[]): string[] {
  return [...SOCKET_FLAG, ...args];
}

let cachedLoggedIn: boolean | null = null;
let cachedLoggedInTime = 0;
const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`;

export function isTailscaleLoggedIn(): boolean {
  const now = Date.now();
  if (cachedLoggedIn !== null && (now - cachedLoggedInTime) < 10000) {
    return cachedLoggedIn;
  }

  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000
    });
    const json = JSON.parse(out);
    // BackendState "Running" means fully logged in and connected
    const result = json.BackendState === "Running";
    cachedLoggedIn = result;
    cachedLoggedInTime = now;
    return result;
  } catch (e) {
    return false;
  }
}

let cachedRunning: boolean | null = null;
let cachedRunningTime = 0;
export function isTailscaleRunning(): boolean {
  const now = Date.now();
  if (cachedRunning !== null && (now - cachedRunningTime) < 10000) {
    return cachedRunning;
  }

  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json 2>/dev/null`, { encoding: "utf8", windowsHide: true });
    const json = JSON.parse(out);
    const result = Object.keys(json.AllowFunnel || {}).length > 0;
    cachedRunning = result;
    cachedRunningTime = now;
    return result;
  } catch (e) {
    return false;
  }
}

/** Get funnel URL from tailscale status */
export function getTailscaleFunnelUrl(port: number): string | null {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, { encoding: "utf8", windowsHide: true });
    const json = JSON.parse(out);
    const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
    if (dnsName) return `https://${dnsName}`;
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Install tailscale.
 */
export async function installTailscale(sudoPassword: string, hostname: string, onProgress?: (msg: string) => void): Promise<{ success: boolean; authUrl?: string; alreadyLoggedIn?: boolean }> {
  const log = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { success: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  const loginResult = await startLogin(hostname);
  return { success: true, ...loginResult };
}

function hasBrew(): boolean {
  try { execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } }); return true; } catch { return false; }
}

async function installTailscaleMac(sudoPassword: string, log: (msg: string) => void): Promise<void> {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("brew", ["install", "tailscale"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }
      });
      child.stdout?.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr?.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c) => {
        if (c === 0) resolve();
        else reject(new Error(`brew install failed (code ${c})`));
      });
      child.on("error", reject);
    });
    return;
  }

  // No brew: download .pkg and install via sudo installer
  const pkgUrl = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const pkgPath = path.join(os.tmpdir(), "tailscale.pkg");

  log("Downloading Tailscale package...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("curl", ["-fL", "--progress-bar", pkgUrl, "-o", pkgPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stderr?.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      if (c === 0) resolve();
      else reject(new Error("Download failed"));
    });
    child.on("error", reject);
  });

  log("Installing package...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sudo", ["-S", "installer", "-pkg", pkgPath, "-target", "/"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.stdout?.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      try { execSync(`rm -f ${pkgPath}`, { stdio: "ignore", windowsHide: true }); } catch { /* ignore */ }
      if (c === 0) resolve();
      else {
        const msg = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
          ? "Wrong sudo password"
          : stderr || `Exit code ${c}`;
        reject(new Error(msg));
      }
    });
    child.on("error", reject);
    child.stdin?.write(`${sudoPassword}\n`);
    child.stdin?.end();
  });
}

async function installTailscaleLinux(sudoPassword: string, log: (msg: string) => void): Promise<void> {
  log("Downloading install script...");
  return new Promise<void>((resolve, reject) => {
    const curlChild = spawn("curl", ["-fsSL", "https://tailscale.com/install.sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let scriptContent = "";
    let curlErr = "";
    curlChild.stdout?.on("data", (d) => { scriptContent += d.toString(); });
    curlChild.stderr?.on("data", (d) => { curlErr += d.toString(); });
    curlChild.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`Failed to download install script: ${curlErr}`));
      log("Running install script...");
      const child = spawn("sudo", ["-S", "sh"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      child.stdout?.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (c) => {
        if (c === 0) resolve();
        else {
          const msg = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
            ? "Wrong sudo password"
            : stderr || `Exit code ${c}`;
          reject(new Error(msg));
        }
      });
      child.on("error", reject);
      child.stdin?.write(`${sudoPassword}\n`);
      child.stdin?.write(scriptContent);
      child.stdin?.end();
    });
    curlChild.on("error", reject);
  });
}

async function installTailscaleWindows(log: (msg: string) => void): Promise<void> {
  const msiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const msiPath = path.join(os.tmpdir(), "tailscale-setup.msi");

  log("Downloading Tailscale installer...");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("curl.exe", ["-L", "-#", "-o", msiPath, msiUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let lastPct = "";
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      const match = text.match(/(\d+\.\d)%/);
      if (match && match[1] !== lastPct) {
        lastPct = match[1];
        log(`Downloading... ${lastPct}%`);
      }
    });
    child.on("close", (c) => c === 0 ? resolve() : reject(new Error("Download failed")));
    child.on("error", reject);
  });

  log("Installing Tailscale (UAC prompt may appear)...");
  await new Promise<void>((resolve, reject) => {
    const args = `'/i','${msiPath}','TS_NOLAUNCH=true','/quiet','/norestart'`;
    const child = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process msiexec -ArgumentList ${args} -Verb RunAs -Wait`
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stderr?.on("data", (d) => { const l = d.toString().trim(); if (l) log(l); });
    child.on("close", (c) => {
      try { fs.unlinkSync(msiPath); } catch { /* ignore */ }
      c === 0 ? resolve() : reject(new Error(`msiexec failed (code ${c})`));
    });
    child.on("error", reject);
  });

  log("Verifying installation...");
  const maxWait = 10000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

/** Start tailscaled with sudo (TUN mode required for Funnel) */
export async function startDaemonWithPassword(sudoPassword: string): Promise<void> {
  if (IS_WINDOWS) {
    try {
      const bin = getTailscaleBin();
      if (bin) {
        execSync(`"${bin}" status --json`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
        return;
      }
    } catch { /* not running */ }
    try {
      execSync("net start Tailscale", { stdio: "ignore", windowsHide: true, timeout: 10000 });
      await new Promise((r) => setTimeout(r, 3000));
    } catch { /* may need admin, or already running */ }
    return;
  }

  try {
    const bin = getTailscaleBin() || "tailscale";
    execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 3000
    });
    return;
  } catch { /* not running, start it */ }

  if (!fs.existsSync(TAILSCALE_DIR)) fs.mkdirSync(TAILSCALE_DIR, { recursive: true });

  const tailscaledBin = IS_MAC ? "/usr/local/bin/tailscaled" : "tailscaled";
  const daemonCmd = `${tailscaledBin} --socket=${TAILSCALE_SOCKET} --statedir=${TAILSCALE_DIR}`;

  await execWithPassword(`nohup ${daemonCmd} > /dev/null 2>&1 &`, sudoPassword || "");

  await new Promise((r) => setTimeout(r, 3000));
}

function ensureDaemon(): void {
  startDaemonWithPassword("").catch(() => {});
}

export function startLogin(hostname: string): Promise<{ authUrl?: string; alreadyLoggedIn?: boolean }> {
  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise((resolve, reject) => {
    ensureDaemon();

    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    const args = tsArgs("up", "--accept-routes");
    if (hostname) args.push(`--hostname=${hostname}`);
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.unref();
      const url = parseAuthUrl(output);
      if (url) resolve({ authUrl: url });
      else reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const parseAuthUrl = (text: string) => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const handleData = (data: any) => {
      output += data.toString();
      const url = parseAuthUrl(output);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        child.unref();
        resolve({ authUrl: url });
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const url = parseAuthUrl(output);
      if (url) resolve({ authUrl: url });
      else if (code === 0 || isTailscaleLoggedIn()) resolve({ alreadyLoggedIn: true });
      else reject(new Error(`tailscale up exited with code ${code}`));
    });
  });
}

export async function startFunnel(port: number): Promise<{ tunnelUrl?: string; funnelNotEnabled?: boolean; enableUrl?: string }> {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e) { /* ignore */ }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const url = getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    const parseFunnelUrl = (text: string) =>
      (text.match(/https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net[^\s]*/i) || [])[0]?.replace(/\/$/, "") || null;

    let funnelNotEnabled = false;

    const handleData = (data: any) => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url = parseFunnelUrl(output);
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      const url = parseFunnelUrl(output) || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function stopFunnel(): void {
  const bin = getTailscaleBin();
  if (!bin) return;
  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e) { /* ignore */ }
}

export async function stopDaemon(sudoPassword: string): Promise<void> {
  try { execSync("pkill -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { /* ignore */ }

  try { execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 }); } catch { return; }

  if (!IS_WINDOWS) {
    try { await execWithPassword("pkill -x tailscaled", sudoPassword || ""); } catch { /* ignore */ }
  }

  try { if (fs.existsSync(TAILSCALE_SOCKET)) fs.unlinkSync(TAILSCALE_SOCKET); } catch { /* ignore */ }
}
