import fs from "fs/promises";
import { execFile } from "child_process";
import path from "path";
import os from "os";

const IDE_PROBE_TIMEOUT_MS = 2000;

// Install paths per provider per platform — Trae and standard Windsurf IDE locations.
const IDE_PATHS = {
  trae: {
    darwin: ["/Applications/Trae.app"],
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Trae", "Trae.exe"),
      path.join(process.env.ProgramFiles || "", "Trae", "Trae.exe"),
    ],
    linux: ["/usr/bin/trae", "/usr/local/bin/trae", "/opt/trae", "/opt/Trae"],
  },
  windsurf: {
    darwin: ["/Applications/Windsurf.app"],
    win32: [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Windsurf", "Windsurf.exe"),
      path.join(process.env.ProgramFiles || "", "Windsurf", "Windsurf.exe"),
    ],
    linux: ["/usr/bin/windsurf", "/usr/local/bin/windsurf", "/opt/windsurf", "/opt/Windsurf"],
  },
};

const IDE_BINARIES = {
  trae: "trae",
  windsurf: "windsurf",
};

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function checkBinary(bin) {
  try {
    const executable = os.platform() === "win32" ? "where.exe" : "which";
    await new Promise((resolve, reject) => {
      execFile(
        executable,
        [bin],
        { windowsHide: true, timeout: IDE_PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    return true;
  } catch { return false; }
}

// Returns { installed: boolean, path: string|null } for the given provider's IDE.
export async function detectIdeInstalled(providerId) {
  const platform = os.platform();
  const paths = IDE_PATHS[providerId];
  if (!paths) return { installed: false, path: null };
  for (const p of paths[platform] || []) {
    if (p && await pathExists(p)) return { installed: true, path: p };
  }
  const bin = IDE_BINARIES[providerId];
  if (bin && await checkBinary(bin)) return { installed: true, path: bin };
  return { installed: false, path: null };
}
