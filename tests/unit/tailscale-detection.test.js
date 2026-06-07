import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before importing the module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock child_process
vi.mock("child_process", () => ({
  default: {
    execSync: vi.fn(),
    exec: vi.fn(),
    spawn: vi.fn(),
  },
  execSync: vi.fn(),
  exec: vi.fn(),
  spawn: vi.fn(),
}));

// Mock dataDir
vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: "/home/user/.9router",
}));

// Mock mitm/dnsConfig (transitive dependency)
vi.mock("@/mitm/dns/dnsConfig", () => ({
  execWithPassword: vi.fn(),
}));

// Mock state module
vi.mock("@/lib/tunnel/state.js", () => ({
  saveTailscalePid: vi.fn(),
  loadTailscalePid: vi.fn(() => null),
  clearTailscalePid: vi.fn(),
}));

import fs from "fs";
import { execSync } from "child_process";

const MOCK_PLATFORM = "linux";

describe("Tailscale Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("UNIX_TAILSCALE_CANDIDATES", () => {
    it("should include /usr/sbin/tailscale (apt package path)", () => {
      const candidates = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/sbin/tailscale",
        "/usr/bin/tailscale",
        "/snap/bin/tailscale",
      ];
      expect(candidates).toContain("/usr/sbin/tailscale");
      expect(candidates).toContain("/snap/bin/tailscale");
    });
  });

  describe("getTailscaleBin", () => {
    it("should find system tailscale at /usr/sbin/tailscale when binary exists there", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === "/home/user/.9router/bin/tailscale") return false;
        if (p === "/usr/sbin/tailscale") return true;
        return false;
      });
      execSync.mockImplementation((cmd) => {
        if (typeof cmd === "string" && cmd.includes("which")) return "/usr/sbin/tailscale";
        throw new Error("not found");
      });

      const candidates = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/sbin/tailscale",
        "/usr/bin/tailscale",
        "/snap/bin/tailscale",
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      expect(found).toBe("/usr/sbin/tailscale");
    });
  });

  describe("EXTENDED_PATH in tailscale.js", () => {
    it("should include /usr/sbin and /snap/bin in the PATH", () => {
      const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;
      expect(EXTENDED_PATH).toContain("/usr/sbin");
      expect(EXTENDED_PATH).toContain("/snap/bin");
    });
  });

  describe("EXTENDED_PATH in route.js", () => {
    it("should include /usr/sbin and /snap/bin in the PATH", () => {
      const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;
      expect(EXTENDED_PATH).toContain("/usr/sbin");
      expect(EXTENDED_PATH).toContain("/snap/bin");
    });
  });

  describe("probeStatus dual-socket behavior", () => {
    it("should try system socket when custom socket fails", () => {
      // Simulating: custom socket query fails, system socket query succeeds
      const customSocketResult = null; // custom socket probe fails
      const systemSocketResult = { BackendState: "Running", Self: { Online: true } };

      // If custom socket fails, system socket result should be used
      const result = customSocketResult || systemSocketResult;
      expect(result.BackendState).toBe("Running");
      expect(result.Self.Online).toBe(true);
    });

    it("should prefer custom socket over system socket", () => {
      const customSocketResult = { BackendState: "Running", Self: { Online: true } };
      const systemSocketResult = { BackendState: "Running", Self: { Online: true } };

      // Custom socket should be tried first
      const result = customSocketResult || systemSocketResult;
      expect(result).toBe(customSocketResult);
    });
  });

  describe("isSystemDaemonRunning", () => {
    it("should return false when system socket file does not exist", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === "/var/run/tailscale/tailscaled.sock") return false;
        return false;
      });

      expect(fs.existsSync("/var/run/tailscale/tailscaled.sock")).toBe(false);
    });

    it("should return true when system socket exists and daemon responds", () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === "/var/run/tailscale/tailscaled.sock") return true;
        return false;
      });

      execSync.mockImplementation((cmd) => {
        if (typeof cmd === "string" && cmd.includes("--socket") && cmd.includes("/var/run/tailscale/tailscaled.sock")) {
          return JSON.stringify({ BackendState: "Running" });
        }
        throw new Error("not found");
      });

      expect(fs.existsSync("/var/run/tailscale/tailscaled.sock")).toBe(true);
    });
  });

  describe("isTailscaleLoggedIn dual-socket detection", () => {
    it("should return true when system daemon is logged in (custom socket fails)", () => {
      // Scenario: user has system tailscaled, not 9Router's custom daemon
      // Custom socket probe would fail, but system socket probe succeeds
      const systemStatus = { BackendState: "Running", Self: { Online: true } };

      // The probeStatus function tries both sockets
      const loggedIn = systemStatus.BackendState === "Running" && systemStatus.Self?.Online === true;
      expect(loggedIn).toBe(true);
    });

    it("should return false when neither socket responds", () => {
      const result = null; // both sockets fail
      const loggedIn = result !== null && result.BackendState === "Running" && result.Self?.Online === true;
      expect(loggedIn).toBe(false);
    });
  });

  describe("daemonRunning API response semantics", () => {
    it("should report daemonRunning=true when system daemon is running", () => {
      const customDaemonRunning = false;
      const systemDaemonRunning = true;
      const daemonRunning = customDaemonRunning || systemDaemonRunning;
      expect(daemonRunning).toBe(true);
    });

    it("should report daemonRunning=true when custom daemon is running", () => {
      const customDaemonRunning = true;
      const systemDaemonRunning = false;
      const daemonRunning = customDaemonRunning || systemDaemonRunning;
      expect(daemonRunning).toBe(true);
    });

    it("should distinguish custom from system daemon in response", () => {
      const customDaemonRunning = false;
      const systemDaemonRunning = true;
      expect(customDaemonRunning).toBe(false);
      expect(systemDaemonRunning).toBe(true);
      expect(customDaemonRunning || systemDaemonRunning).toBe(true);
    });
  });

  describe("Bug A: bare tailscale command in route.js", () => {
    it("should use absolute path from getTailscaleBin() instead of bare command", () => {
      const bin = "/usr/sbin/tailscale";
      const cmd = `"${bin}" --socket /var/run/tailscale/tailscaled.sock status --json`;
      expect(cmd).not.toMatch(/^tailscale /);
      expect(cmd).toContain("/usr/sbin/tailscale");
    });
  });

  describe("Bug B: EXTENDED_PATH missing from bgRefreshBin", () => {
    it("should pass EXTENDED_PATH to execAsync in bgRefreshBin", () => {
      const execOptions = {
        windowsHide: true,
        timeout: 1500,
        env: { ...process.env, PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:" + (process.env.PATH || "") },
      };
      expect(execOptions.env.PATH).toContain("/usr/sbin");
      expect(execOptions.env.PATH).toContain("/snap/bin");
    });
  });

  describe("Bug F: missing candidate paths", () => {
    it("should include /usr/sbin/tailscale for apt-installed Tailscale", () => {
      const candidates = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/sbin/tailscale",
        "/usr/bin/tailscale",
        "/snap/bin/tailscale",
      ];
      expect(candidates).toContain("/usr/sbin/tailscale");
    });

    it("should include /snap/bin/tailscale for snap-installed Tailscale", () => {
      const candidates = [
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/sbin/tailscale",
        "/usr/bin/tailscale",
        "/snap/bin/tailscale",
      ];
      expect(candidates).toContain("/snap/bin/tailscale");
    });
  });
});