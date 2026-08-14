import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  existsSync: vi.fn(() => true),
  openSync: vi.fn(() => 3),
  closeSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    openSync: mocks.openSync,
    closeSync: mocks.closeSync,
    unlinkSync: mocks.unlinkSync,
    writeFileSync: mocks.writeFileSync,
  },
  existsSync: mocks.existsSync,
  openSync: mocks.openSync,
  closeSync: mocks.closeSync,
  unlinkSync: mocks.unlinkSync,
  writeFileSync: mocks.writeFileSync,
}));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/9router-test" }));

// Find the ACTUAL mock function from the detect module — hoisted mocks are
// resolved per-file; grab it after import for the assertions below.
const detectMocks = vi.hoisted(() => ({
  findHeadroomBinary: vi.fn(() => "/usr/local/bin/headroom"),
  findPython310: vi.fn(() => null),
  HEADROOM_COMPRESSION_EXTRAS: [],
  EXTRA_MARKERS: [],
  getInstalledHeadroomExtras: vi.fn(() => []),
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
  isLoopbackHeadroomUrl: vi.fn(() => true),
}));
// process.js imports detect.js via RELATIVE path './detect.js' — mock that too.
vi.mock("../../src/lib/headroom/detect.js", () => detectMocks);
vi.mock("@/lib/headroom/detect.js", () => detectMocks);

import { startHeadroomProxy } from "../../src/lib/headroom/process.js";

function fakeChild() {
  const child = { pid: 12345, unref: vi.fn(), on: vi.fn(), once: vi.fn(), stderr: { on: vi.fn() } };
  // make the "stays alive briefly" probe pass: process.kill(pid,0) returns true
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "kill").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startHeadroomProxy lossless flag (#2915)", () => {
  it("adds --lossless when lossless option is set", async () => {
    mocks.spawn.mockReturnValue(fakeChild());
    await startHeadroomProxy({ port: 8787, lossless: true });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args).toContain("--lossless");
  }, 20000);

  it("does not add --lossless by default", async () => {
    mocks.spawn.mockReturnValue(fakeChild());
    await startHeadroomProxy({ port: 8787 });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args).not.toContain("--lossless");
  }, 20000);

  it("keeps existing code-aware/kompress flags alongside lossless", async () => {
    mocks.spawn.mockReturnValue(fakeChild());
    await startHeadroomProxy({ port: 8787, codeAware: true, kompress: false, lossless: true });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args).toContain("--code-aware");
    expect(args).toContain("--disable-kompress");
    expect(args).toContain("--lossless");
  }, 20000);
});
