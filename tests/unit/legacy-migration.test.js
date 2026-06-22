// Tests for cli/hooks/migrateLegacy.js
// Uses os.tmpdir() fixtures; monkeypatches os.homedir + process.env.
// Never touches the real home directory.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);

// Paths to bust from the require cache between tests.
const MIGRATE_MOD = require.resolve("../../cli/hooks/migrateLegacy.js");
const DATADIR_MOD = require.resolve("../../src/lib/dataDir.cjs");

function freshMigrateLegacy9router() {
  delete require.cache[MIGRATE_MOD];
  delete require.cache[DATADIR_MOD];
  return require("../../cli/hooks/migrateLegacy.js").migrateLegacy9router;
}

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ml-test-"));
}

describe("migrateLegacy9router", () => {
  let tmpRoot;

  // Env vars to save/restore
  let savedNpmGlobal;
  let savedCI;
  let savedGithubActions;
  let savedInitCwd;
  let savedDataDir;

  beforeEach(() => {
    tmpRoot = makeTmpRoot();

    savedNpmGlobal = process.env.npm_config_global;
    savedCI = process.env.CI;
    savedGithubActions = process.env.GITHUB_ACTIONS;
    savedInitCwd = process.env.INIT_CWD;
    savedDataDir = process.env.DATA_DIR;

    // Set up as a global install (passes context gate by default)
    process.env.npm_config_global = "true";
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    // Point INIT_CWD to a temp dir so workspace heuristic doesn't fire
    process.env.INIT_CWD = tmpRoot;
    // Prevent getDataDir from using a real DATA_DIR
    delete process.env.DATA_DIR;

    // Redirect homedir to tmpRoot
    vi.spyOn(os, "homedir").mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();

    // Restore env
    if (savedNpmGlobal !== undefined) process.env.npm_config_global = savedNpmGlobal;
    else delete process.env.npm_config_global;

    if (savedCI !== undefined) process.env.CI = savedCI;
    else delete process.env.CI;

    if (savedGithubActions !== undefined) process.env.GITHUB_ACTIONS = savedGithubActions;
    else delete process.env.GITHUB_ACTIONS;

    if (savedInitCwd !== undefined) process.env.INIT_CWD = savedInitCwd;
    else delete process.env.INIT_CWD;

    if (savedDataDir !== undefined) process.env.DATA_DIR = savedDataDir;
    else delete process.env.DATA_DIR;

    // Bust module cache after each test
    delete require.cache[MIGRATE_MOD];
    delete require.cache[DATADIR_MOD];

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // (1) Legacy present + force:true → data copied, legacy intact
  it("copies ~/.9router to ~/.durindoor when legacy exists (force=true); legacy preserved", () => {
    const legacyDir = path.join(tmpRoot, ".9router");
    const newDir = path.join(tmpRoot, ".durindoor");

    fs.mkdirSync(path.join(legacyDir, "db"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "db", "data.sqlite"), "fake-db");
    fs.writeFileSync(path.join(legacyDir, "machine-id"), "abc123");

    const migrateLegacy9router = freshMigrateLegacy9router();
    migrateLegacy9router({ force: true });

    // New dir created with copied content
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "db", "data.sqlite"), "utf8")).toBe("fake-db");
    expect(fs.readFileSync(path.join(newDir, "machine-id"), "utf8")).toBe("abc123");

    // Legacy MUST still exist (non-destructive)
    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.readFileSync(path.join(legacyDir, "machine-id"), "utf8")).toBe("abc123");
  });

  // (2) No ~/.9router → gate 1 fires before getDataDir(); ~/.durindoor must NOT be created
  it("returns early (no-op) when ~/.9router does not exist", () => {
    const newDir = path.join(tmpRoot, ".durindoor");

    const migrateLegacy9router = freshMigrateLegacy9router();
    expect(() => migrateLegacy9router({ force: true })).not.toThrow();

    // Gate fired before getDataDir() — durindoor must not exist at all.
    expect(fs.existsSync(newDir)).toBe(false);
  });

  // (3) CI env set → skip (gate 2 fires, no force)
  it("skips when CI=true and force is not set", () => {
    const legacyDir = path.join(tmpRoot, ".9router");
    const newDir = path.join(tmpRoot, ".durindoor");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "machine-id"), "ci-run");

    process.env.CI = "true";
    delete process.env.npm_config_global; // not a global install either

    const migrateLegacy9router = freshMigrateLegacy9router();
    migrateLegacy9router(); // no force

    // durindoor must NOT have been created by migration
    // (getDataDir was not called → no copy → no ~/.durindoor from migration)
    expect(fs.existsSync(newDir)).toBe(false);
    // Legacy untouched
    expect(fs.existsSync(legacyDir)).toBe(true);
  });

  // (4) ~/.durindoor already exists → no overwrite
  it("does not overwrite ~/.durindoor when it already exists", () => {
    const legacyDir = path.join(tmpRoot, ".9router");
    const newDir = path.join(tmpRoot, ".durindoor");

    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "machine-id"), "old-id");

    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, "machine-id"), "new-id");

    const migrateLegacy9router = freshMigrateLegacy9router();
    migrateLegacy9router({ force: true });

    // new dir's content must be unchanged (dataDir._migrateIfNeeded is a no-op
    // when newDir already exists)
    expect(fs.readFileSync(path.join(newDir, "machine-id"), "utf8")).toBe("new-id");
    // Legacy untouched
    expect(fs.readFileSync(path.join(legacyDir, "machine-id"), "utf8")).toBe("old-id");
  });

  // (5) Service artifact detected → helper runs without throwing; unit file untouched
  it("detects systemd unit and logs without modifying it; does not throw", () => {
    const legacyDir = path.join(tmpRoot, ".9router");
    fs.mkdirSync(legacyDir, { recursive: true });

    // Seed a fake systemd unit inside our tmpRoot
    const systemdDir = path.join(tmpRoot, ".config", "systemd", "user");
    fs.mkdirSync(systemdDir, { recursive: true });
    const unitFile = path.join(systemdDir, "9router.service");
    const unitContent = "[Unit]\nDescription=fake\n";
    fs.writeFileSync(unitFile, unitContent);

    const migrateLegacy9router = freshMigrateLegacy9router();
    expect(() => migrateLegacy9router({ force: true })).not.toThrow();

    // Unit file must be untouched
    expect(fs.readFileSync(unitFile, "utf8")).toBe(unitContent);
  });
});
