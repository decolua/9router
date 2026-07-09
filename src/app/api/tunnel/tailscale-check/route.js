import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { isTailscaleInstalled, isTailscaleLoggedIn, isSystemDaemonRunning, getTailscaleBin, TAILSCALE_SOCKET } from "@/lib/tunnel";
import { getCachedPassword, loadEncryptedPassword } from "@/mitm/manager";

const execAsync = promisify(exec);
const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;
const PROBE_TIMEOUT_MS = 1500;

async function hasBrew() {
  try {
    await execAsync("which brew", { windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch { return false; }
}

async function isCustomDaemonRunning() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    await execAsync(`"${bin}" --socket ${TAILSCALE_SOCKET} status --json`, {
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: PROBE_TIMEOUT_MS
    });
    return true;
  } catch {
    try {
      await execAsync("pgrep -x tailscaled", { windowsHide: true, timeout: PROBE_TIMEOUT_MS });
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
      installed ? isCustomDaemonRunning() : Promise.resolve(false),
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
