import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let cachedVersionInfo = null;

export function parseCodexClientVersion(raw) {
  if (!raw) return null;
  return String(raw).match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1] || null;
}

export async function getInstalledCodexClientVersion({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedVersionInfo) return cachedVersionInfo;
  try {
    const { stdout, stderr } = await execFileAsync("codex", ["--version"], {
      windowsHide: true,
      timeout: 5_000,
    });
    const raw = `${stdout || ""} ${stderr || ""}`.trim();
    cachedVersionInfo = {
      installed: true,
      raw,
      version: parseCodexClientVersion(raw),
    };
  } catch {
    cachedVersionInfo = { installed: false, raw: null, version: null };
  }
  return cachedVersionInfo;
}
