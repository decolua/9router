// Tests for src/lib/dataDir.cjs non-destructive migration logic.
// Uses os.tmpdir() fixtures; spies on os.homedir so no real ~/.durindoor is touched.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dd-test-"));
}

function freshGetDataDir() {
  // Bust CJS cache so each test gets a fresh module (DATA_DIR + homedir re-evaluated).
  const modPath = require.resolve("../../src/lib/dataDir.cjs");
  delete require.cache[modPath];
  return require("../../src/lib/dataDir.cjs").getDataDir();
}

describe("dataDir.cjs migration", () => {
  let tmpRoot;
  let legacyDir;
  let newDir;
  let savedDataDir;

  beforeEach(() => {
    tmpRoot = makeTmpRoot();
    legacyDir = path.join(tmpRoot, ".9router");
    newDir = path.join(tmpRoot, ".durindoor");
    savedDataDir = process.env.DATA_DIR;
    delete process.env.DATA_DIR;
    vi.spyOn(os, "homedir").mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedDataDir !== undefined) {
      process.env.DATA_DIR = savedDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    // Bust cache after test so subsequent tests start clean.
    const modPath = require.resolve("../../src/lib/dataDir.cjs");
    delete require.cache[modPath];
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("copies legacy → new when legacy exists and new absent; legacy remains intact", () => {
    fs.mkdirSync(path.join(legacyDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "db", "data.sqlite"), "fake-db-content");
    fs.writeFileSync(path.join(legacyDir, "machine-id"), "test-machine-id");

    const result = freshGetDataDir();

    expect(result).toBe(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "db", "data.sqlite"), "utf8")).toBe("fake-db-content");
    expect(fs.readFileSync(path.join(newDir, "machine-id"), "utf8")).toBe("test-machine-id");

    // Legacy MUST remain intact
    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.readFileSync(path.join(legacyDir, "db", "data.sqlite"), "utf8")).toBe("fake-db-content");
    expect(fs.readFileSync(path.join(legacyDir, "machine-id"), "utf8")).toBe("test-machine-id");
  });

  it("no-op when new dir already exists (does not overwrite)", () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "machine-id"), "old-machine-id");
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "machine-id"), "new-machine-id");

    const result = freshGetDataDir();

    expect(result).toBe(newDir);
    expect(fs.readFileSync(path.join(newDir, "machine-id"), "utf8")).toBe("new-machine-id");
    expect(fs.readFileSync(path.join(legacyDir, "machine-id"), "utf8")).toBe("old-machine-id");
  });

  it("creates new dir empty when neither exists (fresh install)", () => {
    const result = freshGetDataDir();

    expect(result).toBe(newDir);
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.readdirSync(newDir)).toEqual([]);
  });
});
