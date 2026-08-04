import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../../cli/cli.js", import.meta.url));
const source = fs.readFileSync(CLI_PATH, "utf8");

describe("Windows launcher lifecycle", () => {
  it("probes the router health endpoint instead of killing port owners", () => {
    expect(source).toContain("function probeExistingRouter(port)");
    expect(source).toContain('path: "/api/health"');
    expect(source).not.toContain("killAllAppProcesses");
    expect(source).not.toContain("killProcessOnPort");
    expect(source).not.toContain("killCloudflaredByAppPort");
    expect(source).not.toMatch(/(?:execSync|spawn)\s*\([^\n]*(?:powershell|netstat|next-server)/i);
  });

  it("owns its server child and bounds crash restarts", () => {
    expect(source).toContain("detached: false,");
    expect(source).not.toContain("process.kill(-server.pid");
    expect(source).toContain("MAX_RESTARTS_PER_WINDOW = 2");
    expect(source).toContain("RESTART_WINDOW_MS = 5 * 60 * 1000");
    expect(source).toContain("Server crashed too many times in five minutes");
    expect(source).not.toContain("db.json");
  });

  it("uses an explicit, bounded tray hand-off without cmd.exe", () => {
    expect(source).toContain("function waitForPortRelease(port, timeoutMs = 15000)");
    expect(source).toContain("function spawnBackgroundTray(port)");
    expect(source).toContain("bgProcess = await spawnBackgroundTray(port)");
    expect(source).not.toContain("const bgProcess = spawn(");
    expect(source).toContain('"--takeover"');
    expect(source).not.toMatch(/shell\s*:\s*true/);
  });

  it("does not trust a recycled service PID file during shutdown", () => {
    expect(source).toContain("function stopVerifiedMitmByPidFile()");
    expect(source).toContain("function verifyMitmPid(pid)");
    expect(source).not.toContain("killTunnelByPidFile");
    expect(source).not.toContain("killProxyByPidFile");
  });
});
