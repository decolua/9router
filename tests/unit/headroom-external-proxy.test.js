import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import { findHeadroomBinary } from "../../src/lib/headroom/detect.js";
import { restartHeadroomProxy, startHeadroomProxy } from "../../src/lib/headroom/process.js";

vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "test-data" }));
vi.mock("fs", () => ({ default: {
  existsSync: vi.fn(() => false), mkdirSync: vi.fn(), openSync: vi.fn(() => 99),
  readFileSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(), closeSync: vi.fn(),
} }));
vi.mock("child_process", () => ({ execFileSync: vi.fn(), execSync: vi.fn(), spawn: vi.fn() }));
vi.mock("../../src/lib/headroom/detect.js", async (importOriginal) => ({
  ...await importOriginal(), findHeadroomBinary: vi.fn(),
}));

const url = "http://127.0.0.1:9878";
const external = { running: true, external: true, alreadyRunning: true };

beforeEach(() => {
  vi.resetAllMocks();
  fs.existsSync.mockReturnValue(false);
  fs.openSync.mockReturnValue(99);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockEarlyExit() {
  findHeadroomBinary.mockReturnValue("headroom");
  const child = Object.assign(new EventEmitter(), { pid: 123, unref: vi.fn() });
  spawn.mockImplementation(() => {
    setImmediate(() => child.emit("exit", 3));
    return child;
  });
}

describe("Headroom proxy ownership", () => {
  it("uses a healthy external proxy without a PID file or local CLI", async () => {
    fetch.mockResolvedValueOnce(new Response());
    await expect(startHeadroomProxy({ url, port: 9878 })).resolves.toEqual(external);
    expect(fetch).toHaveBeenCalledWith(`${url}/health`, { signal: expect.any(AbortSignal) });
    expect(findHeadroomBinary).not.toHaveBeenCalled();
    expect(fs.openSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns the managed PID without probing or spawning", async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(String(process.pid));
    await expect(startHeadroomProxy({ url })).resolves.toEqual({ pid: process.pid, alreadyRunning: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rechecks health after a startup race and preserves the external proxy", async () => {
    fetch.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce(new Response());
    mockEarlyExit();
    await expect(startHeadroomProxy({ url, port: 9878 })).resolves.toEqual(external);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("keeps the early exit error when the proxy stays down", async () => {
    fetch.mockResolvedValue(new Response(null, { status: 503 }));
    mockEarlyExit();
    await expect(startHeadroomProxy({ url, port: 9878 })).rejects.toMatchObject({ code: "EARLY_EXIT" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a flag unsupported by the installed CLI before spawning", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    findHeadroomBinary.mockReturnValue("headroom");
    execFileSync.mockReturnValue("  --code-aware / --no-code-aware  Enable code-aware compression\n");
    await expect(startHeadroomProxy({ url, kompress: false })).rejects.toMatchObject({
      code: "UNSUPPORTED_PROXY_OPTION", message: expect.stringContaining("--disable-kompress"),
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes supported options to the managed proxy", async () => {
    fetch.mockResolvedValue(new Response(null, { status: 503 }));
    mockEarlyExit();
    execFileSync.mockReturnValue("  --code-aware / --no-code-aware\n  --disable-kompress\n");
    await expect(startHeadroomProxy({ url, port: 9878, codeAware: true, kompress: false }))
      .rejects.toMatchObject({ code: "EARLY_EXIT" });
    expect(spawn).toHaveBeenCalledWith("headroom", ["proxy", "--port", "9878", "--code-aware", "--disable-kompress"], expect.any(Object));
  });

  it("checks new flags before stopping the managed proxy on restart", async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("123");
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    findHeadroomBinary.mockReturnValue("headroom");
    execFileSync.mockReturnValue("  --code-aware / --no-code-aware\n");

    await expect(restartHeadroomProxy({ url, kompress: false })).rejects.toMatchObject({
      code: "UNSUPPORTED_PROXY_OPTION",
    });
    expect(kill.mock.calls).toEqual([[123, 0]]);
    expect(spawn).not.toHaveBeenCalled();
  });
});
