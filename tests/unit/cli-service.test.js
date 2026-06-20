import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const svc = require("../../cli/src/cli/service/index.js");

describe("9router service unit generation", () => {
  it("systemdUnitText launches custom-server.js with quoted paths + env + restart", () => {
    const text = svc.systemdUnitText(
      "/usr/bin/node",
      "/opt/9router/app/custom-server.js",
      "/opt/9router/app",
      { PORT: "20128", HOSTNAME: "0.0.0.0", NODE_ENV: "production" }
    );
    expect(text).toContain('ExecStart="/usr/bin/node" "/opt/9router/app/custom-server.js"');
    expect(text).toContain("Environment=PORT=20128");
    expect(text).toContain("Environment=HOSTNAME=0.0.0.0");
    expect(text).toContain("Environment=NODE_ENV=production");
    expect(text).toContain("Restart=on-failure");
    expect(text).toContain("WantedBy=default.target");
    expect(text).toContain("WorkingDirectory=/opt/9router/app");
  });

  it("launchdPlist has RunAtLoad, KeepAlive, ProgramArguments + env", () => {
    const plist = svc.launchdPlist("/usr/local/bin/node", "/x/custom-server.js", "/x", { PORT: "20128", NODE_ENV: "production" });
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("/x/custom-server.js");
    expect(plist).toContain("<key>PORT</key><string>20128</string>");
    expect(plist).toContain("com.9router.server");
  });

  it("systemdUnitPath is under the user systemd dir", () => {
    expect(svc.systemdUnitPath()).toMatch(/\.config\/systemd\/user\/9router\.service$/);
  });

  it("launchdPlistPath is under LaunchAgents", () => {
    expect(svc.launchdPlistPath()).toMatch(/Library\/LaunchAgents\/com\.9router\.server\.plist$/);
  });

  it("runServiceCommand refuses install when customServerPath is missing (exit 1)", () => {
    // runServiceCommand calls process.exit, so exercise it in a subprocess.
    const file = path.resolve("cli/src/cli/service/index.js");
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(file)}).runServiceCommand(["install"], { standaloneDir:"/tmp", customServerPath:"/tmp/does-not-exist-custom-server.js" })`],
        { stdio: "pipe" }
      );
    } catch (e) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it("runServiceCommand rejects an unknown action (exit 2)", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(file)}).runServiceCommand(["bogus"], { standaloneDir:"/tmp", customServerPath:"/tmp/x" })`],
        { stdio: "pipe" }
      );
    } catch (e) {
      exitCode = e.status ?? 2;
    }
    expect(exitCode).toBe(2);
  });
});
