import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  existsSync: vi.fn(),
}));

const routeMocks = vi.hoisted(() => ({
  getTailscaleBackendStatus: vi.fn(),
  getTailscaleBin: vi.fn(),
  isSystemDaemonRunning: vi.fn(),
  isTailscaleInstalled: vi.fn(),
  isTailscaleLoggedIn: vi.fn(),
  getCachedPassword: vi.fn(),
  loadEncryptedPassword: vi.fn(),
}));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal();
  const windowsOs = { ...actual, platform: () => "win32" };
  return { ...actual, default: windowsOs, platform: windowsOs.platform };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  const mockedFs = { ...actual, existsSync: mocks.existsSync };
  return { ...actual, default: mockedFs, existsSync: mocks.existsSync };
});

vi.mock("child_process", () => ({
  exec: vi.fn(),
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
  execSync: vi.fn(),
  spawn: mocks.spawn,
}));

vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "C:\\9router-test" }));
vi.mock("@/mitm/dns/dnsConfig", () => ({ execWithPassword: vi.fn() }));
vi.mock("@/lib/tunnel", () => ({
  TAILSCALE_SOCKET: "C:\\9router-test\\tailscale\\tailscaled.sock",
  getTailscaleBackendStatus: routeMocks.getTailscaleBackendStatus,
  getTailscaleBin: routeMocks.getTailscaleBin,
  isSystemDaemonRunning: routeMocks.isSystemDaemonRunning,
  isTailscaleInstalled: routeMocks.isTailscaleInstalled,
  isTailscaleLoggedIn: routeMocks.isTailscaleLoggedIn,
}));
vi.mock("@/mitm/manager", () => ({
  getCachedPassword: routeMocks.getCachedPassword,
  loadEncryptedPassword: routeMocks.loadEncryptedPassword,
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ body, status: init?.status || 200 }),
  },
}));

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

describe("Windows Tailscale process controls", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.existsSync.mockImplementation((candidate) => String(candidate).endsWith("tailscale.exe"));
    routeMocks.getTailscaleBackendStatus.mockResolvedValue({ BackendState: "NeedsLogin" });
    routeMocks.getTailscaleBin.mockReturnValue("C:\\Program Files\\Tailscale\\tailscale.exe");
    routeMocks.isSystemDaemonRunning.mockReturnValue(false);
    routeMocks.isTailscaleInstalled.mockReturnValue(true);
    routeMocks.isTailscaleLoggedIn.mockReturnValue(false);
    routeMocks.getCachedPassword.mockReturnValue(null);
    routeMocks.loadEncryptedPassword.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces concurrent backend status probes into one direct executable call", async () => {
    const callbacks = [];
    mocks.execFile.mockImplementation((file, args, options, callback) => {
      callbacks.push({ file, args, options, callback });
      return {};
    });

    const { getTailscaleBackendStatus } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    const first = getTailscaleBackendStatus({ force: true });
    const second = getTailscaleBackendStatus({ force: true });
    const third = getTailscaleBackendStatus({ force: true });

    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].file).toMatch(/tailscale\.exe$/i);
    expect(callbacks[0].file).not.toMatch(/cmd\.exe/i);
    expect(callbacks[0].args).toEqual(["status", "--json"]);
    expect(callbacks[0].options).toEqual(expect.objectContaining({ windowsHide: true }));

    // child_process.execFile has a custom promisifier that resolves an object
    // with stdout/stderr; mirror that result shape in this focused mock.
    callbacks[0].callback(null, {
      stdout: JSON.stringify({
        BackendState: "Running",
        Self: { Online: true, DNSName: "router.tailnet.ts.net." },
      }),
      stderr: "",
    });

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.objectContaining({ BackendState: "Running" }),
      expect.objectContaining({ BackendState: "Running" }),
      expect.objectContaining({ BackendState: "Running" }),
    ]);

    await getTailscaleBackendStatus();
    expect(callbacks).toHaveLength(1);
  });

  it("shares one login subprocess and kills it when the bounded login expires", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mocks.spawn.mockReturnValue(child);
    // Leave the daemon status request pending: the login timeout must still
    // settle and terminate its child instead of leaving it detached forever.
    mocks.execFile.mockImplementation(() => ({}));

    const { startLogin } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    const first = startLogin("router");
    const second = startLogin("router");

    expect(second).toBe(first);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    await expect(first).rejects.toThrow("tailscale up timed out without auth URL");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(2000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("retains one owned browser-login session until explicit cancellation", async () => {
    vi.useFakeTimers();
    const child = makeChild();
    mocks.spawn.mockReturnValue(child);
    mocks.execFile.mockImplementation(() => ({}));

    const { startLogin, cancelTailscaleLogin } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    const first = startLogin("router");
    child.stdout.emit("data", "Visit https://login.tailscale.com/a/abc123");

    await expect(first).resolves.toEqual({ authUrl: "https://login.tailscale.com/a/abc123" });
    await expect(startLogin("router-again")).resolves.toEqual({ authUrl: "https://login.tailscale.com/a/abc123" });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);

    expect(cancelTailscaleLogin("user cancelled login")).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(cancelTailscaleLogin()).toBe(false);
  });

  it("coalesces concurrent funnel recovery and cancels it before reset", async () => {
    const child = makeChild();
    mocks.spawn.mockReturnValue(child);
    mocks.execFile.mockImplementation((file, args, options, callback) => {
      callback(null, "", "");
      return {};
    });

    const { startFunnel, stopFunnel } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    const first = startFunnel(20128);
    const second = startFunnel(20128);

    expect(second).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    await stopFunnel();
    await expect(first).rejects.toThrow("tailscale funnel cancelled");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses the cached backend status for the Windows check route without Unix probes", async () => {
    const { GET } = await import("../../src/app/api/tunnel/tailscale-check/route.js");

    const response = await GET();

    expect(routeMocks.getTailscaleBackendStatus).toHaveBeenCalledTimes(1);
    expect(routeMocks.isSystemDaemonRunning).toHaveBeenCalledTimes(1);
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(response.body).toEqual(expect.objectContaining({
      platform: "win32",
      daemonRunning: true,
      customDaemonRunning: true,
      systemDaemonRunning: false,
    }));
  });
});
