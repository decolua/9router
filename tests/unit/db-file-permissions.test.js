// The DB stores provider OAuth tokens and plaintext client API keys, so the
// data dir must be 0700 and the DB file 0600 — not the 0755/0644 that the
// default umask (022) produces when no mode is given.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

// chmod is ACL-based on Windows and does not map to POSIX mode bits.
const describePosix = process.platform === "win32" ? describe.skip : describe;

const modeOf = (target) => fs.statSync(target).mode & 0o777;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-perms-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  // DATA_DIR is resolved at module load, so the module graph must be rebuilt
  // for each temp dir (same pattern as db-driver-chain.test.js).
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describePosix("DB file permissions", () => {
  it("creates the data dir and DB file with owner-only permissions", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    const dbDir = path.join(tempDir, "db");
    expect(modeOf(tempDir)).toBe(0o700);
    expect(modeOf(dbDir)).toBe(0o700);
    expect(modeOf(path.join(dbDir, "backups"))).toBe(0o700);
    expect(modeOf(path.join(dbDir, "data.sqlite"))).toBe(0o600);
  });

  it("repairs world-readable permissions left by an existing install", async () => {
    // Simulate a pre-fix install: dirs at 0755, DB at 0644.
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(path.join(dbDir, "backups"), { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "");
    fs.chmodSync(tempDir, 0o755);
    fs.chmodSync(dbDir, 0o755);
    fs.chmodSync(path.join(dbDir, "data.sqlite"), 0o644);

    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    expect(modeOf(tempDir)).toBe(0o700);
    expect(modeOf(dbDir)).toBe(0o700);
    expect(modeOf(path.join(dbDir, "data.sqlite"))).toBe(0o600);
  });

  it("keeps WAL sidecar files owner-only", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    const dbDir = path.join(tempDir, "db");
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = path.join(dbDir, `data.sqlite${suffix}`);
      // Only better-sqlite3/node:sqlite in WAL mode create these.
      if (fs.existsSync(sidecar)) expect(modeOf(sidecar)).toBe(0o600);
    }
  });

  it("writes schema-migration backups owner-only", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const { makeBackupDir, backupDbLite } = await import("@/lib/db/backup.js");

    const dir = makeBackupDir("perm-test");
    const dest = backupDbLite(adapter, dir);

    expect(modeOf(dir)).toBe(0o700);
    expect(modeOf(dest)).toBe(0o600);
  });
});
