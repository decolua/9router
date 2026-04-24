import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { execSync, spawn, ChildProcess } from "child_process";
import { savePid, loadPid, clearPid } from "./state";
import { DATA_DIR } from "@/lib/dataDir";

const BIN_DIR = path.join(DATA_DIR, "bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

const GITHUB_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const PLATFORM_MAPPINGS: Record<string, Record<string, string>> = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

const PLATFORM_FALLBACK: Record<string, string> = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64"
};

function getDownloadUrl(): string {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName = platformMapping[arch] || PLATFORM_FALLBACK[platform];
  return `${GITHUB_BASE_URL}/${binaryName}`;
}

const dlState = { downloading: false, progress: 0 };

export function getDownloadStatus(): { downloading: boolean; progress: number } {
  return { downloading: dlState.downloading, progress: dlState.progress };
}

function downloadFile(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        file.close();
        fs.unlinkSync(dest);
        const location = response.headers.location;
        if (!location) return reject(new Error("Redirect location missing"));
        downloadFile(location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"] || "0", 10) || 0;
      let receivedBytes = 0;
      dlState.downloading = true;
      dlState.progress = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) dlState.progress = Math.round((receivedBytes / totalBytes) * 100);
      });

      response.pipe(file);

      file.on("finish", () => {
        dlState.downloading = false;
        dlState.progress = 100;
        file.close(() => resolve(dest));
      });

      file.on("error", (err) => {
        dlState.downloading = false;
        dlState.progress = 0;
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on("error", (err) => {
      dlState.downloading = false;
      dlState.progress = 0;
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

const MIN_BINARY_SIZE = 1024 * 1024; // 1MB - cloudflared is ~30MB+

function isValidBinary(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise: Promise<string> | null = null;

export async function ensureCloudflared(): Promise<string> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function _ensureCloudflared(): Promise<string> {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const tmpPath = `${BIN_PATH}.tmp`;
  if (fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!isValidBinary(BIN_PATH)) {
      console.log("[cloudflared] Invalid binary detected, re-downloading...");
      fs.unlinkSync(BIN_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  await downloadFile(url, downloadDest);

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe", windowsHide: true });
    fs.unlinkSync(downloadDest);
  } else {
    fs.renameSync(downloadDest, BIN_PATH);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess: ChildProcess | null = null;
let unexpectedExitHandler: (() => void) | null = null;

export function setUnexpectedExitHandler(handler: (() => void) | null): void {
  unexpectedExitHandler = handler;
}

export async function spawnCloudflared(tunnelToken: string): Promise<ChildProcess> {
  const binaryPath = await ensureCloudflared();

  const child = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  if (child.pid) savePid(child.pid);

  return new Promise((resolve, reject) => {
    let connectionCount = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      resolved = true;
      resolve(child);
    }, 90000);

    const handleLog = (data: any) => {
      const msg = data.toString();
      const matches = msg.match(/Registered tunnel connection/g);
      if (matches) {
        connectionCount += matches.length;
        if (connectionCount >= 4 && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    };

    child.stdout?.on("data", handleLog);
    child.stderr?.on("data", handleLog);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    child.on("exit", (code) => {
      cloudflaredProcess = null;
      clearPid();
      const wasConnected = resolved;
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (connectionCount === 0) {
          reject(new Error(`cloudflared exited with code ${code}`));
          return;
        }
      }
      if (wasConnected && unexpectedExitHandler) {
        unexpectedExitHandler();
      }
    });
  });
}

export async function spawnQuickTunnel(localPort: number, onUrlUpdate: (url: string) => void): Promise<{ child: ChildProcess; tunnelUrl: string }> {
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(configDir, "config.yml");
  fs.writeFileSync(configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    try {
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  };

  const child = spawn(binaryPath, ["tunnel", "--url", `http://localhost:${localPort}`, "--config", configPath, "--no-autoupdate"], {
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  if (child.pid) savePid(child.pid);

  return new Promise((resolve, reject) => {
    let resolved = false;

    function getQuickTunnelUrlFromLog(message: string): string | null {
      const regex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates = [];

      for (const match of message.matchAll(regex)) {
        const host = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1];
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Quick tunnel timed out"));
    }, 90000);

    let lastUrl: string | null = null;

    const handleLog = (data: any) => {
      const msg = data.toString();
      const tunnelUrl = getQuickTunnelUrlFromLog(msg);
      if (!tunnelUrl) return;

      if (!resolved) {
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        resolve({ child, tunnelUrl });
        return;
      }

      if (tunnelUrl !== lastUrl) {
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout?.on("data", handleLog);
    child.stderr?.on("data", handleLog);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      reject(err);
    });

    child.on("exit", (code) => {
      cloudflaredProcess = null;
      clearPid();
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`cloudflared exited with code ${code}`));
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

export function killCloudflared(): void {
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill();
    } catch (e) { /* ignore */ }
    cloudflaredProcess = null;
  }

  const pid = loadPid();
  if (pid) {
    try {
      process.kill(pid);
    } catch (e) { /* ignore */ }
    clearPid();
  }

  try {
    execSync("pkill -f cloudflared 2>/dev/null || true", { stdio: "ignore", windowsHide: true });
  } catch (e) { /* ignore */ }
}

export function isCloudflaredRunning(): boolean {
  const pid = loadPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}
