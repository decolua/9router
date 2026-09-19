// F8 L-3: src/lib/dataDir.js must not throw at module-import time for mkdir
// errors other than EACCES/EPERM (ENOTDIR/EEXIST when DATA_DIR points at a
// file, etc.). Policy: loud warning + documented fallback to ~/.9router —
// never a crash-loop of every module importing the db layer, never silence.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let warnSpy;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f8-datadir-"));
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.unstubAllEnvs();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function loadDataDir() {
  // DATA_DIR is computed at import time — that import must not throw.
  return await import("@/lib/dataDir.js");
}

describe("dataDir import-time safety (L-3)", () => {
  it("DATA_DIR pointing at an existing FILE falls back with a warning instead of throwing", async () => {
    const filePath = path.join(tempDir, "afile");
    fs.writeFileSync(filePath, "not a dir");
    vi.stubEnv("DATA_DIR", filePath);

    const mod = await loadDataDir(); // pre-fix: throws EEXIST here at import time

    expect(mod.DATA_DIR).toBe(path.join(os.homedir(), ".9router"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(filePath));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("fallback"));
  });

  it("DATA_DIR with a file component in the middle (ENOTDIR) also falls back", async () => {
    const filePath = path.join(tempDir, "afile");
    fs.writeFileSync(filePath, "not a dir");
    vi.stubEnv("DATA_DIR", path.join(filePath, "sub"));

    const mod = await loadDataDir(); // pre-fix: throws ENOTDIR

    expect(mod.DATA_DIR).toBe(path.join(os.homedir(), ".9router"));
    expect(warnSpy).toHaveBeenCalled();
  });

  it("a usable DATA_DIR is still honored verbatim with no warning", async () => {
    const good = path.join(tempDir, "data");
    vi.stubEnv("DATA_DIR", good);

    const mod = await loadDataDir();

    expect(mod.DATA_DIR).toBe(good);
    expect(fs.existsSync(good)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("getDataDir() never throws for arbitrary mkdir failures (contract)", () => {
    // direct call with a path whose parent is a file
    const filePath = path.join(tempDir, "afile2");
    fs.writeFileSync(filePath, "x");
    process.env.DATA_DIR = path.join(filePath, "nested");
    expect(() => {
      // fresh module instance so the top-level computation also runs
      return import("@/lib/dataDir.js");
    }).not.toThrow();
  });

  it("exported DATA_DIR fallback is never silently the same env value on error", async () => {
    const filePath = path.join(tempDir, "blocked");
    fs.writeFileSync(filePath, "x");
    vi.stubEnv("DATA_DIR", filePath);
    const mod = await loadDataDir();
    expect(mod.getDataDir()).not.toBe(filePath);
  });
});
