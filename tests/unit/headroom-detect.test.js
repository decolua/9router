import { describe, it, expect, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(() => Buffer.from(JSON.stringify([
    { name: "headroom-ai", version: "0.26.0" },
    { name: "tree-sitter", version: "0.25.0" },
  ]))),
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
}));

import {
  clearHeadroomDetectionCache,
  findHeadroomBinary,
  findPython310,
  getHeadroomStatus,
  getInstalledHeadroomExtras,
  isLoopbackHeadroomUrl,
} from "../../src/lib/headroom/detect.js";

afterEach(() => {
  clearHeadroomDetectionCache();
  vi.clearAllMocks();
});

describe("headroom detect", () => {
  it("detects installed headroom version and caches the pip-list probe", () => {
    const first = getInstalledHeadroomExtras("python3");
    const second = getInstalledHeadroomExtras("python3");

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "python3",
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      expect.objectContaining({ windowsHide: true, timeout: 8000 }),
    );
    expect(first).toEqual({
      installed: true,
      version: "0.26.0",
      extras: { code: true, ml: false },
    });
    expect(second).toEqual(first);
  });

  it("uses a direct bounded command lookup and caches binary detection", () => {
    mocks.execFileSync.mockImplementation((file, args) => {
      if (args.join(" ") === "headroom") return Buffer.from("C:/Python/Scripts/headroom.exe\n");
      throw new Error(`unexpected probe: ${file} ${args.join(" ")}`);
    });

    expect(findHeadroomBinary()).toBe("C:/Python/Scripts/headroom.exe");
    expect(findHeadroomBinary()).toBe("C:/Python/Scripts/headroom.exe");
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      process.platform === "win32" ? "where.exe" : "which",
      ["headroom"],
      expect.objectContaining({ windowsHide: true, timeout: 2000 }),
    );
  });

  it("probes a Python version without constructing a shell command", () => {
    mocks.execFileSync.mockImplementation((file, args) => {
      if (args.join(" ") === "headroom") throw new Error("headroom unavailable");
      if (file === "python3.13" && args.join(" ") === "--version") return Buffer.from("Python 3.13.0\n");
      if (file === "python3.13" && args.join(" ") === "-m pip show headroom-ai") {
        return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      }
      throw new Error(`unexpected probe: ${file} ${args.join(" ")}`);
    });

    expect(findPython310()).toBe("python3.13");
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "python3.13",
      ["--version"],
      expect.objectContaining({ windowsHide: true, timeout: 2000 }),
    );
  });

  it("keeps top-level installed flag true when extras are readable", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execFileSync.mockImplementation((file, args) => {
      if (args.join(" ") === "headroom") return Buffer.from("/missing/headroom\n");
      if (file === "python" && args.join(" ") === "--version") return Buffer.from("Python 3.13.0\n");
      if (file === "python" && args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      if (file === "python" && args.join(" ").startsWith("-m pip list ")) return Buffer.from(JSON.stringify([
        { name: "headroom-ai", version: "0.26.0" },
        { name: "tree-sitter", version: "0.25.0" },
      ]));
      throw new Error(`unexpected probe: ${file} ${args.join(" ")}`);
    });

    const status = await getHeadroomStatus("http://localhost:8787");

    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.26.0");
    expect(status.extras).toEqual({ code: true, ml: false });
  });

  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execFileSync.mockImplementation(() => { throw new Error("not found"); });

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.installed).toBe(false);
    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(status.canStart).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/health", expect.any(Object));
  });

  it("recognizes loopback URLs for managed local mode", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });
});
