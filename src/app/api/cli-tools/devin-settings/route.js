"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// Mirror the executor's resolveDevinBin discovery so the dashboard's status
// matches what the runtime actually spawns.
const candidateDevinPaths = () => {
  const home = os.homedir();
  const isWin = os.platform() === "win32";
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  // Mirror resolveDevinBin in the executor — cover installer + common
  // package-manager locations so detection matches runtime resolution.
  return isWin
    ? [
      path.join(localAppData, "devin", "cli", "bin", "devin.exe"),
      path.join(home, ".local", "bin", "devin.exe"),
      path.join(home, "scoop", "shims", "devin.exe"),
      path.join(localAppData, "Programs", "devin", "devin.exe"),
    ]
    : [
      path.join(home, ".local", "share", "devin", "bin", "devin"),
      path.join(home, ".devin", "bin", "devin"),
      path.join(home, ".local", "bin", "devin"),
      "/opt/homebrew/bin/devin",
      "/usr/local/bin/devin",
      "/usr/bin/devin",
    ];
};

const checkDevinInstalled = async () => {
  // 1. PATH lookup
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where devin" : "which devin";
    await execAsync(command, { windowsHide: true });
    return { installed: true, source: "path" };
  } catch {
    // fall through to filesystem probes
  }
  // 2. Known installer paths
  for (const candidate of candidateDevinPaths()) {
    try {
      await fs.access(candidate);
      return { installed: true, source: candidate };
    } catch { /* keep probing */ }
  }
  return { installed: false, source: null };
};

const readDevinVersion = async () => {
  try {
    const { stdout } = await execAsync("devin --version", { windowsHide: true });
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
};

// GET — install detection only. No config to write: the binary handles its own auth.
export async function GET() {
  try {
    const { installed, source } = await checkDevinInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        message: "Devin CLI is not installed. Install it from https://cli.devin.ai and run `devin auth login`.",
        installUrl: "https://cli.devin.ai",
      });
    }
    const version = await readDevinVersion();
    return NextResponse.json({
      installed: true,
      source,
      version,
      message: "Devin CLI detected. Make sure `devin auth login` has been run.",
    });
  } catch (error) {
    console.log("Error checking devin settings:", error);
    return NextResponse.json({ error: "Failed to check devin settings" }, { status: 500 });
  }
}
