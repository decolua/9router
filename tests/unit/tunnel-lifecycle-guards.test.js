import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const managerSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/lib/tunnel/cloudflare/manager.js", import.meta.url)),
  "utf8",
);
const cloudflaredSource = fs.readFileSync(
  fileURLToPath(new URL("../../src/lib/tunnel/cloudflare/cloudflared.js", import.meta.url)),
  "utf8",
);

describe("Cloudflare tunnel lifecycle guards", () => {
  it("coalesces concurrent enable operations before spawning cloudflared", () => {
    expect(managerSource).toContain("enablePromise: null");
    expect(managerSource).toContain("if (svc.enablePromise)");
    expect(managerSource).toContain("return svc.enablePromise;");
    expect(managerSource).toContain("enableTunnelImpl(localPort, token)");
  });

  it("does not let a cancelled enable restore tunnel state", () => {
    expect(managerSource).toMatch(/await registerTunnelUrl\(shortId, tunnelUrl\);\s+throwIfCancelled\(token\);\s+saveState/s);
    expect(managerSource).toMatch(/saveState\(\{ shortId, tunnelUrl \}\);\s+throwIfCancelled\(token\);\s+await updateSettings/s);
  });

  it("terminates failed quick-tunnel children and avoids shell PowerShell", () => {
    expect(cloudflaredSource).toContain("terminateChild(child);");
    expect(cloudflaredSource).toContain("Promise.resolve(onUrlUpdate(tunnelUrl)).catch");
    expect(cloudflaredSource).toContain('execFileSync("powershell.exe"');
    expect(cloudflaredSource).not.toContain("POWERSHELL_HIDDEN_COMMAND");
    expect(cloudflaredSource).not.toMatch(/execSync\([^\n]*powershell/i);
  });
});
