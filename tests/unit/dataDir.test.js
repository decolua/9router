import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("DATA_DIR fallback", () => {
  it("falls back to the default user directory when configured DATA_DIR is not writable", async () => {
    process.env.DATA_DIR = path.join(os.tmpdir(), "9router-unwritable");
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    });

    const { DATA_DIR } = await import("@/lib/dataDir.js");
    expect(DATA_DIR).toBe(path.join(os.homedir(), ".9router"));
  });
});
