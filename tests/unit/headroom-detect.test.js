import { describe, it, expect, vi, afterEach } from "vitest";
import path from "path";

const normalizePath = (p) => String(p).split(path.sep).join("/").toLowerCase();

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error("not found"); }),
  execFile: vi.fn(() => ({ toString: () => "[object Object]" })),
  execFileSync: vi.fn(() => Buffer.from(JSON.stringify([
    { name: "headroom-ai", version: "0.26.0" },
    { name: "tree-sitter", version: "0.25.0" },
  ]))),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

import { findPython310, getHeadroomStatus, getInstalledHeadroomExtras, isLoopbackHeadroomUrl } from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("findPython310 probe budget", () => {
  it("probes version candidates with a small timeout and never blocks the event loop for tens of seconds", () => {
    // vi.clearAllMocks() does NOT reset implementations — restore the hoisted
    // default afterwards so this probe cannot leak into the suites below.
    const defaultExecFileSync = mocks.execFileSync.getMockImplementation();
    try {
      mocks.execSync.mockImplementation((cmd) => {
        if (String(cmd).includes("where") || String(cmd).includes("which")) throw new Error("not found");
        throw new Error(`unexpected execSync: ${cmd}`);
      });
      mocks.execFileSync.mockImplementation(() => { throw new Error("candidate missing"); });

      findPython310();
    } finally {
      mocks.execFileSync.mockImplementation(defaultExecFileSync);
    }

    const probes = mocks.execFileSync.mock.calls.filter((c) => c[1][0] === "--version");
    expect(probes).not.toHaveLength(0);
    for (const call of probes) expect(call[2].timeout).toBeLessThan(2000);
  });
});

describe("headroom detect", () => {
  it("detects installed headroom version and extras from pip list", () => {
    const result = getInstalledHeadroomExtras("python3");

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "python3",
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      expect.objectContaining({ windowsHide: true, timeout: 8000 }),
    );
    expect(result).toEqual({
      installed: true,
      version: "0.26.0",
      extras: { code: true, ml: false },
    });
  });

  it("prefers the interpreter that actually has headroom-ai installed", () => {
    // headroom binary lives in a bin dir; the python next to it has headroom-ai.
    const binPython = "/opt/hr/bin/python3";
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("/opt/hr/bin/headroom\n");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args[0] === "--version") return Buffer.from("Python 3.13.0\n");
      if (args.join(" ") === "-m pip show headroom-ai") {
        // Platform-neutral identity: same dir + interpreter basename, ignoring
        // OS separator and Windows .exe suffix differences.
        const base = (s) => normalizePath(s).split("/").pop().replace(/\.exe$/, "");
        const dirOf = (s) => normalizePath(s).split("/").slice(0, -1).join("/");
        if (base(py) === base(binPython) && dirOf(py) === dirOf(binPython)) {
          return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
        }
        throw new Error(`not installed in ${py}`);
      }
      throw new Error(`unexpected execFileSync: ${py} ${args.join(" ")}`);
    });

    // Platform-neutral: Windows resolves separators and .exe suffix differently.
    expect(normalizePath(findPython310())).toContain(normalizePath("/opt/hr/bin/python"));
  });

  it("probes version via execFileSync(candidate, ['--version']) so paths with spaces never hit a shell", () => {
    // Program Files style candidate — spaces would be mangled by shell string interpolation.
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) {
        return Buffer.from("C:\\Program Files\\Headroom\\headroom.exe\n");
      }
      throw new Error(`unexpected execSync: ${cmd}`);
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args[0] === "--version") return Buffer.from("Python 3.12.4\n");
      if (args.join(" ") === "-m pip show headroom-ai" && String(py).includes("Program Files")) {
        return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      }
      throw new Error(`not installed in ${py}`);
    });

    const py = findPython310();
    // Candidate invoked AS an executable with argv — not interpolated into a shell string.
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      expect.stringContaining("Program Files"),
      ["--version"],
      expect.objectContaining({ windowsHide: true }),
    );
    const probeCalls = mocks.execFileSync.mock.calls.filter((c) => c[1][0] === "--version");
    expect(probeCalls.length).toBeGreaterThan(0);
    expect(py).toBeTruthy();
    expect(normalizePath(py)).toContain("program files");
  });

  it("keeps top-level installed flag true when extras are readable", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("C:/Python/Scripts/headroom.exe\n");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args[0] === "--version") return Buffer.from("Python 3.13.0\n");
      // Version probing no longer hits findHeadroomBinary loop irrelevantly;
      // identity on pip mocks stays stable across the execFileSync migration.
      if (String(py).includes("python3") && args.join(" ") === "-m pip show headroom-ai") throw new Error("not installed in python3");
      if (args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      if (args.join(" ").startsWith("-m pip list ")) return Buffer.from(JSON.stringify([
        { name: "headroom-ai", version: "0.26.0" },
        { name: "tree-sitter", version: "0.25.0" },
      ]));
      throw new Error(`unexpected execFileSync: ${py} ${args.join(" ")}`);
    });

    const status = await getHeadroomStatus("http://localhost:8787");

    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.26.0");
    expect(status.extras).toEqual({ code: true, ml: false });
  });

  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) throw new Error("not found");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation(() => { throw new Error("pip unavailable"); });

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
