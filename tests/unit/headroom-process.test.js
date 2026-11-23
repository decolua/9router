import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: "/tmp/mock-data-dir",
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    readFileSync: mocks.readFileSync,
    unlinkSync: mocks.unlinkSync,
  },
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  unlinkSync: mocks.unlinkSync,
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
  spawn: vi.fn(),
}));

import { getManagedPid, stopHeadroomProxy } from "../../src/lib/headroom/process.js";

describe("headroom process management", () => {
  const originalKill = process.kill;

  beforeEach(() => {
    vi.clearAllMocks();
    process.kill = mocks.kill;
  });

  afterEach(() => {
    process.kill = originalKill;
  });

  it("returns null when no pid file exists and port has no listening process", () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.execSync.mockImplementation(() => { throw new Error("not found"); });

    expect(getManagedPid(8787)).toBeNull();
  });

  it("returns port pid when pid file is missing but a headroom process is listening on the port", () => {
    mocks.existsSync.mockImplementation((p) => p === "/proc/12345/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p === "/proc/12345/cmdline") return "python /usr/local/bin/headroom proxy --port 8787";
      throw new Error("unexpected readFileSync");
    });
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("lsof -ti tcp:8787 -sTCP:LISTEN")) return Buffer.from("12345\n");
      throw new Error("unexpected command");
    });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 12345 && sig === 0) return true;
      throw new Error("process not found");
    });

    expect(getManagedPid(8787)).toBe(12345);
  });

  it("rejects unrelated listening processes that do not match headroom identity", () => {
    mocks.existsSync.mockImplementation((p) => p === "/proc/99999/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p === "/proc/99999/cmdline") return "node /usr/src/app/unrelated-server.js";
      throw new Error("unexpected readFileSync");
    });
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("lsof -ti tcp:8787 -sTCP:LISTEN")) return Buffer.from("99999\n");
      throw new Error("unexpected command");
    });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 99999 && sig === 0) return true;
      throw new Error("process not found");
    });

    expect(getManagedPid(8787)).toBeNull();
  });

  it("rejects processes when headroom proxy is merely an argument rather than the invoked command", () => {
    mocks.existsSync.mockImplementation((p) => p === "/proc/88888/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p === "/proc/88888/cmdline") return "grep -rn headroom proxy /tmp";
      throw new Error("unexpected readFileSync");
    });
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("lsof -ti tcp:8787 -sTCP:LISTEN")) return Buffer.from("88888\n");
      throw new Error("unexpected command");
    });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 88888 && sig === 0) return true;
      throw new Error("process not found");
    });

    expect(getManagedPid(8787)).toBeNull();
  });

  it("does not adopt PID file process if configured for a different port", () => {
    mocks.existsSync.mockImplementation((p) => p.includes("proxy.pid") || p === "/proc/77777/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p.includes("proxy.pid")) return "77777\n";
      if (p === "/proc/77777/cmdline") return "headroom proxy --port 8787";
      throw new Error("unexpected readFileSync");
    });
    // Nothing listening on port 9000
    mocks.execSync.mockImplementation(() => { throw new Error("not found"); });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 77777 && sig === 0) return true;
      throw new Error("process not found");
    });

    // Requesting port 9000 should not adopt the instance running on port 8787
    expect(getManagedPid(9000)).toBeNull();
    // Requesting port 8787 should match it
    expect(getManagedPid(8787)).toBe(77777);
  });

  it("recognizes port passed with equals syntax --port=9000", () => {
    mocks.existsSync.mockImplementation((p) => p.includes("proxy.pid") || p === "/proc/66666/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p.includes("proxy.pid")) return "66666\n";
      if (p === "/proc/66666/cmdline") return "headroom proxy --port=9000";
      throw new Error("unexpected readFileSync");
    });
    mocks.execSync.mockImplementation(() => { throw new Error("not found"); });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 66666 && sig === 0) return true;
      throw new Error("process not found");
    });

    expect(getManagedPid(9000)).toBe(66666);
    expect(getManagedPid(8787)).toBeNull();
  });

  it("handles quoted command line paths containing spaces across platforms", () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.execSync.mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes("lsof")) return Buffer.from("55555\n");
      if (s.includes("netstat")) return Buffer.from("  TCP    127.0.0.1:8787         0.0.0.0:0              LISTENING       55555\n");
      if (s.includes("wmic")) return Buffer.from('CommandLine\n"C:\\\\Program Files\\\\Python\\\\Scripts\\\\headroom.exe" proxy --port 8787\n');
      if (s.includes("ps -p")) return Buffer.from('"C:\\\\Program Files\\\\Python\\\\Scripts\\\\headroom.exe" proxy --port 8787\n');
      throw new Error(`unexpected command: ${cmd}`);
    });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 55555 && sig === 0) return true;
      throw new Error("process not found");
    });

    expect(getManagedPid(8787)).toBe(55555);
  });

  it("ignores invalid port inputs when probing listening process", () => {
    mocks.existsSync.mockReturnValue(false);
    // Invalid port should return null without invoking execSync
    expect(getManagedPid("invalid; rm -rf /")).toBeNull();
    expect(mocks.execSync).not.toHaveBeenCalled();
    expect(getManagedPid(999999)).toBeNull();
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it("stops proxy discovered via port when pid file is absent", () => {
    mocks.existsSync.mockImplementation((p) => p === "/proc/12345/cmdline");
    mocks.readFileSync.mockImplementation((p) => {
      if (p === "/proc/12345/cmdline") return "python /usr/local/bin/headroom proxy --port 8787";
      throw new Error("unexpected readFileSync");
    });
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("lsof -ti tcp:8787 -sTCP:LISTEN")) return Buffer.from("12345\n");
      throw new Error("unexpected command");
    });
    mocks.kill.mockImplementation((pid, sig) => {
      if (pid === 12345 && (sig === 0 || sig === "SIGTERM")) return true;
      throw new Error("process not found");
    });

    const result = stopHeadroomProxy({ port: 8787 });
    expect(result).toEqual({ stopped: true, pid: 12345 });
    expect(mocks.kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });
});
