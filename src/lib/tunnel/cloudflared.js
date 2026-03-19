import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { execSync, spawn } from "child_process";
import { savePid, loadPid, clearPid } from "./state.js";

const BIN_DIR = path.join(os.homedir(), ".9router", "bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

const GITHUB_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const PLATFORM_MAPPINGS = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-amd64.tgz"
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe"
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64"
  }
};

function getDownloadUrl() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName = platformMapping[arch];
  if (!binaryName) {
    throw new Error(`Unsupported architecture: ${arch} for platform ${platform}`);
  }

  return `${GITHUB_BASE_URL}/${binaryName}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if ([301, 302].includes(response.statusCode)) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on("finish", () => {
        file.close(() => resolve(dest));
      });

      file.on("error", (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on("error", (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

export async function ensureCloudflared() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!IS_WINDOWS) {
      fs.chmodSync(BIN_PATH, "755");
    }
    return BIN_PATH;
  }

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(BIN_DIR, "cloudflared.tgz") : BIN_PATH;

  await downloadFile(url, downloadDest);

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe" });
    fs.unlinkSync(downloadDest);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  return BIN_PATH;
}

let cloudflaredProcess = null;
let unexpectedExitHandler = null;

/** Register a callback to be called when cloudflared exits unexpectedly after connecting */
export function setUnexpectedExitHandler(handler) {
  unexpectedExitHandler = handler;
}

export async function spawnCloudflared(tunnelToken) {
  const binaryPath = await ensureCloudflared();

  const child = spawn(binaryPath, ["tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", tunnelToken], {
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  cloudflaredProcess = child;
  savePid(child.pid);

  return new Promise((resolve, reject) => {
    let connectionCount = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      resolved = true;
      resolve(child);
    }, 90000);

    const handleLog = (data) => {
      const msg = data.toString();
      // Count exact occurrences in this chunk (each chunk may contain multiple lines)
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

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

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
      const wasConnected = resolved; // true = already connected successfully
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (connectionCount === 0) {
          reject(new Error(`cloudflared exited with code ${code}`));
          return;
        }
      }
      // Only notify on unexpected exit AFTER successful connection
      if (wasConnected && unexpectedExitHandler) {
        unexpectedExitHandler();
      }
    });
  });
}

/**
 * Spawn cloudflared quick tunnel (no account needed)
 * Returns the generated trycloudflare.com URL
 */
export async function spawnQuickTunnel(localPort, onUrlUpdate) {
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(configDir, "config.yml");
  // Avoid using default ~/.cloudflared/config.yml, which can conflict with quick tunnel behavior.
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
  savePid(child.pid);

  return new Promise((resolve, reject) => {
    let resolved = false;

    function getQuickTunnelUrlFromLog(message) {
      // cloudflared logs may contain "api.trycloudflare.com" as well,
      // but that is NOT the quick-tunnel endpoint we need.
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

    const handleLog = (data) => {
      const msg = data.toString();
      const tunnelUrl = getQuickTunnelUrlFromLog(msg);
      if (tunnelUrl && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ child, tunnelUrl });
        // Notify caller of URL (for re-registration on URL change)
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    child.stdout.on("data", handleLog);
    child.stderr.on("data", handleLog);

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

export function killCloudflared() {
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

  // Kill any remaining cloudflared processes
  try {
    execSync("pkill -f cloudflared 2>/dev/null || true", { stdio: "ignore" });
  } catch (e) { /* ignore */ }
}

export function isCloudflaredRunning() {
  const pid = loadPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}
