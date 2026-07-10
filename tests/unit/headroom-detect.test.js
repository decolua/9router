import { describe, it, expect, vi, afterEach } from "vitest";

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
  execFileSync: mocks.execFileSync,
  execFile: mocks.execFile,
}));

// Mock path detection for test stability.
vi.mock("../src/lib/headroom/detect.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
  };
});

import {
  findHeadroomBinary,
  findPython310,
  probeProxyRunning,
  isLoopbackHeadroomUrl,
  getHeadroomStatus,
  getInstalledHeadroomExtras,
  HEADROOM_COMPRESSION_EXTRAS,
  EXTRA_MARKERS,
} from "../src/lib/headroom/detect.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findHeadroomBinary", () => {
  it("returns null when which/where fails", () => {
    mocks.execSync.mockImplementation(() => { throw new Error("not found"); });
    expect(findHeadroomBinary()).toBeNull();
  });

  it("returns the binary path on success", () => {
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("/opt/hr/bin/headroom\n");
      throw new Error("unexpected execSync");
    });
    expect(findHeadroomBinary()).toBe("/opt/hr/bin/headroom");
  });
});

describe("findPython310", () => {
  afterEach(() => {
    mocks.execSync.mockReset();
    mocks.execFileSync.mockReset();
  });

  it("returns null when no candidate works", () => {
    mocks.execSync.mockImplementation(() => { throw new Error("not found"); });
    expect(findPython310()).toBeNull();
  });

  it("returns python3 when it is >= 3.10 and has headroom-ai", () => {
    mocks.execSync.mockImplementation((cmd) => {
      // findHeadroomBinary called first by pythonCandidates
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("/opt/hr/bin/headroom\n");
      if (String(cmd).includes("--version")) return Buffer.from("Python 3.12.0\n");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      throw new Error("unexpected execFileSync");
    });
    // python3 is the first bare name candidate after EXTRA_BINS; when run headroom-adjacent
    // candidates fail, it falls through to the bare list
    expect(typeof findPython310()).toBe("string");
  });

  it("returns a fallback when headroom-ai pip check fails but version qualifies", () => {
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("C:/Python/Scripts/headroom.exe\n");
      if (String(cmd).includes("python3 --version")) return Buffer.from("Python 3.13.0\n");
      if (String(cmd).includes("python --version")) return Buffer.from("Python 3.13.0\n");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (py === "python3" && args.join(" ") === "-m pip show headroom-ai") throw new Error("not installed in python3");
      if (py === "python" && args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      if (py === "python" && args.join(" ").startsWith("-m pip list ")) return Buffer.from(JSON.stringify([
        { name: "headroom-ai", version: "0.26.0" },
        { name: "tree-sitter", version: "0.25.0" },
      ]));
      throw new Error(`unexpected execFileSync: ${py} ${args.join(" ")}`);
    });

    expect(findPython310()).toBe("python");
  });
});

describe("probeProxyRunning", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns false for empty URL", async () => {
    expect(await probeProxyRunning()).toBe(false);
  });

  it("returns true when health endpoint responds ok", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await probeProxyRunning("http://localhost:8787")).toBe(true);
  });

  it("returns false when health fails", async () => {
    global.fetch = vi.fn(async () => { throw new Error("conn refused"); });
    expect(await probeProxyRunning("http://localhost:8787")).toBe(false);
  });
});

describe("isLoopbackHeadroomUrl", () => {
  it("detects localhost and loopback IPs", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://external:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("")).toBe(false);
  });
});

describe("getHeadroomStatus", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns running=true and installed=true when both CLI and health check pass", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) return Buffer.from("/opt/hr/bin/headroom\n");
      if (String(cmd).includes("--version")) return Buffer.from("Python 3.13.0\n");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\nVersion: 0.26.0\n");
      if (args.join(" ").startsWith("-m pip list ")) return Buffer.from(JSON.stringify([
        { name: "headroom-ai", version: "0.26.0" },
        { name: "tree-sitter", version: "0.25.0" },
      ]));
      throw new Error(`unexpected execFileSync: ${py} ${args.join(" ")}`);
    });

    const status = await getHeadroomStatus("http://localhost:8787");
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
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
  });
});

describe("EXTRA_MARKERS", () => {
  it("defines correct marker packages for each extra", () => {
    expect(EXTRA_MARKERS.code).toContain("tree-sitter");
    expect(EXTRA_MARKERS.ml).toContain("torch");
    expect(EXTRA_MARKERS.ml).toContain("huggingface-hub");
  });
});

describe("HEADROOM_COMPRESSION_EXTRAS", () => {
  it("includes code and ml", () => {
    expect(HEADROOM_COMPRESSION_EXTRAS).toEqual(["code", "ml"]);
  });
});

describe("getInstalledHeadroomExtras", () => {
  afterEach(() => {
    mocks.execFileSync.mockReset();
  });

  it("returns not installed when pip list shows no headroom-ai", () => {
    mocks.execFileSync.mockImplementation(() => Buffer.from(JSON.stringify([
      { name: "some-other-package", version: "1.0.0" },
    ])));

    const result = getInstalledHeadroomExtras("python3");
    expect(result.installed).toBe(false);
    expect(result.version).toBeNull();
  });

  it("detects version and extras from pip list output", () => {
    mocks.execFileSync.mockImplementation(() => Buffer.from(JSON.stringify([
      { name: "headroom-ai", version: "0.27.0" },
      { name: "tree-sitter", version: "0.25.0" },
      { name: "torch", version: "2.5.0" },
    ])));

    const result = getInstalledHeadroomExtras("python3");
    expect(result.installed).toBe(true);
    expect(result.version).toBe("0.27.0");
    expect(result.extras.code).toBe(true);
    expect(result.extras.ml).toBe(true);
  });
});
