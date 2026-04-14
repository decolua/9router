import os from "os";
import { execSync } from "child_process";
import { NextResponse } from "next/server";
import { isTailscaleInstalled, isTailscaleLoggedIn, TAILSCALE_SOCKET } from "@/lib/tunnel/tailscale";

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`;

function hasBrew() {
  try { execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } }); return true; } catch { return false; }
}

function isDaemonRunning() {
  try {
    // Use custom socket + --json; exit 0 even when not logged in
    execSync(`tailscale --socket ${TAILSCALE_SOCKET} status --json`, {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 3000
    });
    return true;
  } catch {
    // Fallback: check if tailscaled process is alive
    try {
      execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 });
      return true;
    } catch { return false; }
  }
}

export async function GET() {
  try {
    const installed = isTailscaleInstalled();
    const platform = os.platform();
    const brewAvailable = platform === "darwin" && hasBrew();
    const daemonRunning = installed ? isDaemonRunning() : false;
    const loggedIn = daemonRunning ? isTailscaleLoggedIn() : false;
    return NextResponse.json({ installed, loggedIn, platform, brewAvailable, daemonRunning });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
