import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import pkg from "../../package.json" with { type: "json" };

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile }));

describe("installed CLI version", () => {
  let previousCache;

  beforeEach(() => {
    previousCache = global.__npmVersionCache;
    global.__npmVersionCache = { value: "99.0.0", fetchedAt: Date.now() };
    readFile.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    global.__npmVersionCache = previousCache;
    vi.restoreAllMocks();
  });

  async function getVersion() {
    const { GET } = await import("../../src/app/api/version/route.js");
    return (await GET()).json();
  }

  it("compares npm latest with the installed wrapper instead of the bundled app", async () => {
    readFile.mockResolvedValue(JSON.stringify({ name: "9router", version: "99.0.0" }));

    expect(await getVersion()).toEqual({
      currentVersion: "99.0.0",
      latestVersion: "99.0.0",
      hasUpdate: false,
    });
    expect(readFile).toHaveBeenCalledWith(path.resolve(process.cwd(), "..", "package.json"), "utf8");
  });

  it("still reports a newer wrapper release", async () => {
    readFile.mockResolvedValue(JSON.stringify({ name: "9router", version: "98.0.0" }));

    expect(await getVersion()).toEqual({
      currentVersion: "98.0.0",
      latestVersion: "99.0.0",
      hasUpdate: true,
    });
  });

  it("reads the wrapper from the actual CLI package layout", async () => {
    const fs = await vi.importActual("node:fs/promises");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "9router-version-"));
    const appDirectory = path.join(directory, "app");
    try {
      await fs.mkdir(appDirectory);
      await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({
        name: "9router", version: "99.0.0",
      }));
      await fs.writeFile(path.join(appDirectory, "package.json"), JSON.stringify({
        name: "9router-app", version: "0.4.28",
      }));
      vi.spyOn(process, "cwd").mockReturnValue(appDirectory);
      readFile.mockImplementation(fs.readFile);

      expect(await getVersion()).toEqual({
        currentVersion: "99.0.0", latestVersion: "99.0.0", hasUpdate: false,
      });
    } finally {
      vi.restoreAllMocks();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { name: "unrelated", version: "99.0.0" },
    { name: "9router" },
    { name: "9router", version: "" },
    { name: "9router", version: 99 },
    null,
  ])("uses the app version when the parent is not a valid wrapper package", async (parent) => {
    readFile.mockResolvedValue(JSON.stringify(parent));

    expect((await getVersion()).currentVersion).toBe(pkg.version);
  });

  it("uses the app version when the parent package is unavailable", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));

    expect((await getVersion()).currentVersion).toBe(pkg.version);
  });

  it("uses the app version when the parent package is malformed", async () => {
    readFile.mockResolvedValue("{invalid");

    expect((await getVersion()).currentVersion).toBe(pkg.version);
  });
});
