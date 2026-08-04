import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  fileURLToPath(new URL("../../src/lib/appUpdater.js", import.meta.url)),
  "utf8",
);
const routeSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/app/api/version/update/route.js", import.meta.url)),
  "utf8",
);

describe("updater process ownership", () => {
  it("stops only PID-file services that it can verify", () => {
    expect(source).toContain("async function isHealthyMitmPid(pid)");
    expect(source).toContain("function stopExpectedPidFile(pidFile, expectedNames)");
    expect(source).toContain('"cloudflared.pid"');
    expect(source).toContain('"tailscale.pid"');
  });

  it("does not scan or kill unrelated Node/Next processes", () => {
    expect(source).not.toContain("collectAppPids");
    expect(source).not.toMatch(/next-server|powershell|shell\s*:\s*true|execSync/i);
    expect(source).toContain('spawnSync("taskkill.exe"');
  });

  it("only exits after the detached updater has actually spawned", () => {
    expect(source).toContain('child.once("spawn"');
    expect(source).toContain("finish(true)");
    expect(source).toContain("finish(false)");
    expect(routeSource).toContain("const updaterStarted = await spawnUpdaterAndExit()");
    expect(routeSource).toContain("Updater could not start; 9router is still running.");
  });
});
