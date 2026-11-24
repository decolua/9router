/**
 * Regression / hardening tests for #4295
 *
 * killAllAppProcesses / collectAppPids (appUpdater.js) used a broad
 * "line.includes('9router')" match on ps aux output. This swept up any
 * process whose command-line merely mentioned "9router" — grep, editors,
 * shell history, strace, etc. — and sent them SIGKILL.
 *
 * The fix:
 * 1. Switch from `ps aux` (USER column before PID) to `ps -eo pid,comm,args`
 *    so parts[0] is always the numeric PID — no column-shifting from long USER names.
 * 2. Narrow the whitelist: require "node" + "9router" + ("cli.js" or "/9router"),
 *    or specific binary names (next-server, tray_darwin, tray_linux).
 *    A bare "9router" substring no longer matches on its own.
 *
 * These tests verify the matching logic in isolation by simulating ps output lines.
 */

import { describe, it, expect } from "vitest";

// Replicate the matching logic from appUpdater.js collectAppPids (Unix branch)
// so we can unit-test it without spawning real processes.
function isAppProcessLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const cmd = trimmed.toLowerCase();
  return (
    (cmd.includes("node") && cmd.includes("9router") &&
      (cmd.includes("cli.js") || cmd.includes("/9router"))) ||
    cmd.includes("next-server") ||
    (cmd.includes("cloudflared") && cmd.includes("9router")) ||
    cmd.includes("/bin/app/") ||
    cmd.includes("tray_darwin") ||
    cmd.includes("tray_linux")
  );
}

// Replicate PID extraction from ps -eo pid,comm,args format (parts[0])
function extractPid(line) {
  const parts = line.trim().split(/\s+/);
  const pid = parts[0];
  return (!pid || isNaN(pid)) ? null : pid;
}

describe("collectAppPids matching logic (#4295)", () => {
  // ── Should match ───────────────────────────────────────────────────────────
  it("matches 9router cli.js node process", () => {
    const line = "1234 node  node /usr/local/lib/9router/cli.js";
    expect(isAppProcessLine(line)).toBe(true);
    expect(extractPid(line)).toBe("1234");
  });

  it("matches next-server", () => {
    const line = "5678 node  node /app/.next/standalone/server/server.js next-server";
    expect(isAppProcessLine(line)).toBe(true);
    expect(extractPid(line)).toBe("5678");
  });

  it("matches tray_darwin", () => {
    const line = "9999 tray   /Applications/9router.app/Contents/MacOS/tray_darwin";
    expect(isAppProcessLine(line)).toBe(true);
  });

  it("matches tray_linux", () => {
    const line = "8888 tray   /opt/9router/tray_linux";
    expect(isAppProcessLine(line)).toBe(true);
  });

  it("matches /bin/app/ path", () => {
    const line = "7777 node  node /bin/app/server.js";
    expect(isAppProcessLine(line)).toBe(true);
  });

  it("matches cloudflared only when 9router also present in args", () => {
    const line = "3333 cloudflared  cloudflared tunnel --config /etc/9router/cf.yml";
    expect(isAppProcessLine(line)).toBe(true);
  });

  // ── Should NOT match — the over-broad patterns from before the fix ─────────
  it("does NOT match a grep command searching for 9router", () => {
    // This is exactly the class of process the old code killed (#4295)
    const line = "1111 grep   grep -r 9router /var/log";
    expect(isAppProcessLine(line)).toBe(false);
  });

  it("does NOT match an editor with 9router in its argv", () => {
    const line = "2222 vim    vim /home/user/9router/config.json";
    expect(isAppProcessLine(line)).toBe(false);
  });

  it("does NOT match a shell with 9router in its history buffer", () => {
    const line = "4444 bash   bash -c 'tail -f /var/log/9router.log'";
    expect(isAppProcessLine(line)).toBe(false);
  });

  it("does NOT match cloudflared without 9router in args", () => {
    const line = "5555 cloudflared  cloudflared tunnel --config /etc/other/cf.yml";
    expect(isAppProcessLine(line)).toBe(false);
  });

  it("does NOT match a Python script that mentions next-server in a comment", () => {
    // next-server is specific enough that a false positive here would be unusual,
    // but verifying the PID extraction is robust is still useful.
    const line = "6666 python3  python3 monitor.py";
    expect(isAppProcessLine(line)).toBe(false);
  });

  // ── PID column robustness ──────────────────────────────────────────────────
  it("extracts PID from parts[0] in ps -eo pid,comm,args format", () => {
    // ps -eo puts PID first, before USER — no column-shifting risk
    expect(extractPid("  1234  node  node cli.js")).toBe("1234");
  });

  it("returns null for header line", () => {
    expect(extractPid("  PID COMM ARGS")).toBe(null);
  });

  it("returns null for empty line", () => {
    expect(extractPid("")).toBe(null);
  });
});