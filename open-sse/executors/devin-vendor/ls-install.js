/**
 * Windsurf LS binary installer.
 *
 * Adapted from dwgx/WindsurfAPI's install-ls.sh. Auto-detects platform,
 * downloads the language_server binary on first use, caches it under
 * ~/.9router/ls/, and returns the absolute path.
 *
 * Lazy install: called from the Devin executor before spawning LS. The
 * binary is ~50MB, so we don't ship it — first request that needs it
 * pulls it from GitHub.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";

const RELEASE_HOSTS = [
  "https://github.com/dwgx/WindsurfAPI/releases/latest/download",
  "https://github.com/CaiJingLong/windsurf-linux-server-release/releases/latest/download",
];

function detectAsset() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") {
    return arch === "arm64" ? "language_server_macos_arm" : "language_server_macos_x64";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "language_server_linux_arm" : "language_server_linux_x64";
  }
  throw new Error(`Unsupported platform: ${platform} (only macOS and Linux supported)`);
}

function installDir() {
  return path.join(os.homedir(), ".9router", "ls");
}

export function lsBinaryPath() {
  // Honor explicit override (matches dwgx LS_BINARY_PATH).
  if (process.env.LS_BINARY_PATH) return process.env.LS_BINARY_PATH;
  return path.join(installDir(), detectAsset());
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "9router-ls-install" },
    }, (res) => {
      // Follow redirects (GitHub release URLs redirect to S3).
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchBinary(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

let installPromise = null;

/**
 * Ensure the LS binary is on disk. Idempotent + concurrency-safe (multiple
 * concurrent callers share the same install promise). Returns the absolute
 * path on success.
 */
export async function ensureLsBinary({ log = console } = {}) {
  const target = lsBinaryPath();
  if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) {
    return target;
  }
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const asset = detectAsset();
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });

    const tmp = `${target}.new.${process.pid}`;
    const errors = [];
    let downloaded = null;

    for (const host of RELEASE_HOSTS) {
      const url = `${host}/${asset}`;
      try {
        log.info?.(`[LS] downloading from ${url}`);
        downloaded = await fetchBinary(url);
        if (downloaded.length < 1_000_000) {
          errors.push(`${host}: response only ${downloaded.length} bytes (likely 404 page)`);
          downloaded = null;
          continue;
        }
        break;
      } catch (e) {
        errors.push(`${host}: ${e.message}`);
      }
    }

    if (!downloaded) {
      throw new Error(`Failed to download ${asset}: ${errors.join(" | ")}`);
    }

    fs.writeFileSync(tmp, downloaded, { mode: 0o755 });
    // Atomic rename: if the binary is currently being mmap'd by a running
    // LS, in-place truncation fails with ETXTBSY but rename(2) just swaps
    // the dirent pointer. Same trick install-ls.sh uses.
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o755);

    const sha = crypto.createHash("sha256").update(downloaded).digest("hex").slice(0, 16);
    log.info?.(`[LS] installed: ${target} (${downloaded.length} bytes, sha256:${sha}...)`);
    return target;
  })();

  try {
    return await installPromise;
  } finally {
    installPromise = null;
  }
}
