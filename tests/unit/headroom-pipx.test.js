import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(), execFileSync: vi.fn(), realpathSync: vi.fn(),
}));
vi.mock("child_process", () => ({ execSync: mocks.execSync, execFileSync: mocks.execFileSync }));
vi.mock("fs", () => ({ realpathSync: mocks.realpathSync }));
vi.mock("path", async () => ({ default: (await vi.importActual("node:path")).posix }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("process", { ...process, platform: "darwin", env: { ...process.env, HOME: "/Users/test" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Headroom pipx interpreter selection (#5530)", () => {
  const bin = "/Users/test/.local/bin/headroom";
  const target = "/Users/test/Library/Application Support/pipx/venvs/headroom-ai/bin/headroom";
  const python = path.posix.join(path.posix.dirname(target), "python3");

  function configureCli(resolved = target) {
    mocks.execSync.mockImplementation((command) => {
      if (command === "which headroom") return Buffer.from(`${bin}\n`);
      // System Python is eligible but has no Headroom installation.
      if (command === "python3 --version") return Buffer.from("Python 3.13.0\n");
      throw new Error(`not found: ${command}`);
    });
    mocks.realpathSync.mockImplementation(() => resolved);
    mocks.execFileSync.mockImplementation((candidate, args) => {
      if (candidate !== python) throw new Error("not the Headroom environment");
      if (args[0] === "--version") return Buffer.from("Python 3.13.0\n");
      if (args.join(" ") === "-m pip show headroom-ai") return Buffer.from("Name: headroom-ai\n");
      if (args.includes("list")) return Buffer.from(JSON.stringify([
        { name: "headroom-ai", version: "0.44.0" },
        { name: "tree-sitter-language-pack", version: "0.13.0" },
        { name: "torch", version: "2.0.0" },
      ]));
      throw new Error(`unexpected args: ${args}`);
    });
  }

  it("selects pipx's Python through the CLI symlink, including a path containing spaces", async () => {
    configureCli();
    const { findPython310, getInstalledHeadroomExtras } = await import("../../src/lib/headroom/detect.js");
    const selected = findPython310();
    expect(selected).toBe(python);
    expect(mocks.realpathSync).toHaveBeenCalledWith(bin);
    expect(mocks.execFileSync).toHaveBeenCalledWith(python, ["--version"], expect.objectContaining({ windowsHide: true }));
    expect(getInstalledHeadroomExtras(selected)).toEqual({
      installed: true, version: "0.44.0", extras: { code: true, ml: true },
    });
  });

  it("probes an ordinary CLI installation with an argument array too", async () => {
    configureCli(bin);
    const sibling = "/Users/test/.local/bin/python3";
    mocks.execFileSync.mockImplementation((candidate, args) => {
      if (candidate !== sibling) throw new Error("not found");
      return Buffer.from(args[0] === "--version" ? "Python 3.12.0\n" : "Name: headroom-ai\n");
    });
    const { findPython310 } = await import("../../src/lib/headroom/detect.js");
    expect(findPython310()).toBe(sibling);
  });

  it("continues searching when the CLI cannot be resolved", async () => {
    configureCli();
    mocks.realpathSync.mockImplementation(() => { throw new Error("missing"); });
    mocks.execFileSync.mockImplementation((candidate, args) => {
      if (candidate !== "python3") throw new Error("not found");
      return Buffer.from(args[0] === "--version" ? "Python 3.13.0\n" : "Name: headroom-ai\n");
    });
    const { findPython310 } = await import("../../src/lib/headroom/detect.js");
    expect(findPython310()).toBe("python3");
  });
});
