import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DESKTOP_MODELS_CACHE = path.join(os.homedir(), ".codex", "models_cache.json");
let cachedVersionInfo = null;

export function parseCodexClientVersion(raw) {
  if (!raw) return null;
  return String(raw).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1] || null;
}

export function parseCodexDesktopModelCacheVersion(raw) {
  try {
    return parseCodexClientVersion(JSON.parse(raw)?.client_version);
  } catch {
    return null;
  }
}

async function getCodexDesktopCachedVersion() {
  try {
    return parseCodexDesktopModelCacheVersion(
      await fs.readFile(DESKTOP_MODELS_CACHE, "utf8")
    );
  } catch {
    return null;
  }
}

export async function getInstalledCodexClientVersion({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedVersionInfo) return cachedVersionInfo;
  try {
    const { stdout, stderr } = await execFileAsync("codex", ["--version"], {
      windowsHide: true,
      timeout: 5_000,
    });
    const raw = `${stdout || ""} ${stderr || ""}`.trim();
    const version = parseCodexClientVersion(raw);
    if (version) {
      cachedVersionInfo = { installed: true, raw, version, source: "cli" };
      return cachedVersionInfo;
    }
  } catch {
    // Codex Desktop can register a WindowsApps shim that cannot be executed.
  }
  const cachedVersion = await getCodexDesktopCachedVersion();
  cachedVersionInfo = cachedVersion
    ? { installed: false, raw: null, version: cachedVersion, source: "desktop-cache" }
    : { installed: false, raw: null, version: null, source: null };
  return cachedVersionInfo;
}
