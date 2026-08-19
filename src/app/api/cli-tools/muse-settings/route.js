"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * GET /api/cli-tools/muse-settings — Muse Code install detection.
 * No config file to write: Muse is pointed at 9Router via env vars
 * (META_API_KEY + --base-url), so the dashboard only reports install
 * status and shows guide steps.
 *
 * Platform note: Muse Code ships no native Windows build — the installer
 * hard-fails outside macOS/Linux. On Windows the supported route is WSL2
 * (install Muse inside the Linux distro). The 9Router endpoint itself stays
 * on the Windows host, so WSL2 guests reach it via http://localhost:20128.
 */
export async function GET() {
  try {
    const isWindows = process.platform === "win32";
    let installed = false;
    let source = null;
    let detection = "path";
    // WSL2 detection: `wsl` exists and the distro has `muse` on PATH.
    if (isWindows) {
      try {
        const { stdout } = await execAsync("wsl which muse", { windowsHide: true });
        if (stdout.trim()) {
          installed = true;
          source = `wsl:${stdout.trim()}`;
          detection = "wsl";
        }
      } catch {
        /* not installed in WSL either */
      }
    } else {
      try {
        await execAsync("which muse", { windowsHide: true });
        installed = true;
        source = "path";
      } catch {
        const { homedir } = await import("node:os");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const candidates = [
          path.join(homedir(), ".muse", "bin", "muse"),
          path.join(homedir(), ".local", "bin", "muse"),
        ];
        for (const candidate of candidates) {
          try {
            await fs.access(candidate);
            installed = true;
            source = candidate;
            break;
          } catch {
            /* try next */
          }
        }
      }
    }

    if (!installed) {
      return NextResponse.json({
        installed: false,
        settings: null,
        platform: isWindows ? "windows" : "posix",
        message: isWindows
          ? "Muse Code has no native Windows build. Install WSL2, then inside the Linux distro run: curl -fsSL https://dev.meta.ai/install.sh | sh"
          : "Muse Code is not installed. Install: curl -fsSL https://dev.meta.ai/install.sh | sh",
      });
    }

    return NextResponse.json({
      installed: true,
      settings: { source, detection },
      has9Router: false, // env-based config — always "external"; guide covers launch command
      configPath: source,
      launchCommand: isWindows && detection === "wsl"
        ? 'wsl bash -lc \'export META_API_KEY="<your-9router-key>"; muse --provider meta --base-url "http://localhost:20128/v1"\''
        : 'META_API_KEY="<your-9router-key>" muse --provider meta --base-url "http://localhost:20128/v1"',
    });
  } catch (error) {
    console.log("Error checking muse settings:", error);
    return NextResponse.json({ error: "Failed to check muse settings" }, { status: 500 });
  }
}