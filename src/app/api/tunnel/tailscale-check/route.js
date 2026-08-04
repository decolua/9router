import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { getTailscaleBackendStatus, isTailscaleInstalled, isTailscaleLoggedIn, isSystemDaemonRunning, getTailscaleBin, TAILSCALE_SOCKET } from "@/lib/tunnel";
import { getCachedPassword, loadEncryptedPassword } from "@/mitm/manager";

const execFileAsync = promisify(execFile);
const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;
const PROBE_TIMEOUT_MS = 1500;

async function hasBrew() {
  try {
    await execFileAsync("which", ["brew"], { windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch { return false; }
}

async function isCustomDaemonRunning(platform) {
  // Windows has no Unix socket or pgrep. Reuse the single-flight direct
  // tailscale.exe status probe, which never goes through cmd.exe.
  if (platform === "win32") {
    const status = await getTailscaleBackendStatus();
    return !!status?.BackendState && status.BackendState !== "NoState";
  }

  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    await execFileAsync(bin, ["--socket", TAILSCALE_SOCKET, "status", "--json"], {
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: PROBE_TIMEOUT_MS
    });
    return true;
  } catch {
    try {
      await execFileAsync("pgrep", ["-x", "tailscaled"], { windowsHide: true, timeout: PROBE_TIMEOUT_MS });
      return true;
    } catch { return false; }
  }
}

export async function GET() {
  try {
    const installed = isTailscaleInstalled();
    const platform = os.platform();
    // Run independent probes in parallel — none blocks the event loop
    const [brewAvailable, customDaemonRunning, systemDaemonRunning] = await Promise.all([
      platform === "darwin" ? hasBrew() : Promise.resolve(false),
      installed ? isCustomDaemonRunning(platform) : Promise.resolve(false),
      installed ? Promise.resolve(isSystemDaemonRunning()) : Promise.resolve(false),
    ]);
    const daemonRunning = customDaemonRunning || systemDaemonRunning;
    const loggedIn = daemonRunning ? isTailscaleLoggedIn() : false;
    const hasCachedPassword = !!(getCachedPassword() || await loadEncryptedPassword());
    return NextResponse.json({ installed, loggedIn, platform, brewAvailable, daemonRunning, customDaemonRunning, systemDaemonRunning, hasCachedPassword });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
