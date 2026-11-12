/**
 * HYG-9ROUTER-15 — corrupt/emptied state database: detect, preserve, recover.
 *
 * The real state DB (DATA_DIR/db/data.sqlite) is the only copy of provider
 * connections, API keys and settings. Before this change:
 *
 *   * a truncated/garbled file made every driver fail, and the operator was
 *     told `[DB] No SQLite driver available (bun/better/node/sql.js all
 *     failed)` — the DRIVERS were blamed, the damaged bytes stayed in place
 *     and DATA_DIR/db/backups was never consulted;
 *   * an EMPTIED file (0 bytes) was treated as a brand-new install: migrations
 *     re-applied, previous schema gone, nothing logged at all — silent loss.
 *
 * Coverage here is behavioural and process-shaped: every case runs a REAL
 * boot of the driver (dynamic import after `vi.resetModules()`, so the module
 * reads DATA_DIR fresh), against a temp DATA_DIR, with the adapters actually
 * opening/refusing the files on disk.
 *
 *   1. malformed (truncated, header intact) → loud banner naming the file and
 *      the true cause, damaged bytes PRESERVED under `.corrupt-*` at their
 *      original length, startup continues on a fresh DB, and the misleading
 *      driver message is NOT what the operator sees.
 *   2. garbled (random bytes, no SQLite header) → same contract, classified
 *      from the file itself before any driver is involved.
 *   3. empty (0 bytes) → loud EMPTY path with an explicit DATA LOSS warning,
 *      never a silent migration re-apply; the empty file is preserved too.
 *   4. valid backup under db/backups/<dir>/data.sqlite → restored, asserted by
 *      READING THE SEEDED ROW CONTENT back (not merely "did not throw").
 *   5. an unusable backup is skipped and the next usable one is restored.
 *   6. negative control: a healthy DB is untouched — no rename, no banner,
 *      no warning, rows intact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Each adapter registers process-level shutdown handlers (beforeExit/SIGINT/
// SIGTERM) and the recovery path opens throwaway probe adapters, so a file
// that boots the driver many times would trip Node's default 10-listener limit
// and emit MaxListenersExceededWarning noise.
process.setMaxListeners(100);

let tempDir;
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-state-db-"));
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir; // read at import time by src/lib/dataDir.mjs
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

// ─── helpers ────────────────────────────────────────────────────────────

const dbDir = () => path.join(tempDir, "db");
const dataFile = () => path.join(dbDir(), "data.sqlite");
const backupsDir = () => path.join(dbDir(), "backups");

// A real "restart": fresh module graph + fresh driver singleton, same DATA_DIR.
//
// The full suite runs hundreds of adapter opens across parallel workers, and under
// that contention an open can fail for resource reasons (SQLITE_CANTOPEN /
// "unable to open database file" / EMFILE / SQLITE_BUSY) instead of because the file
// is damaged. The production code deliberately does NOT classify those as corruption
// (a transient I/O error must never move the real state DB aside), so such a boot
// surfaces the generic "[DB] No SQLite driver available …" fatal. Measured once in a
// guarded full-suite run (2026-09-19T04:35:23Z, .gitreins/logs/guard-20260919T043523.749325Z.log):
// three of the cases below red on exactly that message while the file on disk is
// provably damaged; the same cases pass in isolation, under load, and in two other
// full-suite runs.
//
// A damaged file stays damaged on every attempt, so a bounded retry cannot mask a
// real regression — and the per-driver diagnostics of the last attempt are attached
// to the final error, so a genuine break still names its cause.
async function boot() {
  const ATTEMPTS = 3;
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    delete global._dbAdapter;
    vi.resetModules();
    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      return await getAdapter();
    } catch (e) {
      lastError = e;
      const environmental = /No SQLite driver available/i.test(String(e?.message ?? ""));
      if (!environmental || attempt === ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 150 * attempt)); // let the contention pass
    }
  }
  const detail = await describeChainFailure();
  if (detail) throw new Error(`${lastError?.message}\n  [state-db-corruption test] ${detail}`);
  throw lastError;
}

// Diagnostics only (never an assertion): what each driver says about the file as it
// is on disk right now, so a failure is self-describing.
async function describeChainFailure() {
  const file = dataFile();
  if (!fs.existsSync(file)) return "";
  try {
    const { createAdapterWithChain } = await import("@/lib/db/adapterChain.js");
    const { attempts } = await createAdapterWithChain(file);
    return attempts
      .map((a) => `${a.driver}=${a.status}${a.reason ? ` (${a.reason})` : ""}${a.error ? `: ${a.error.message}` : ""}`)
      .join("; ");
  } catch (e) {
    return `diagnostics unavailable: ${e.message}`;
  }
}

// Seed a marker row through the real adapter, then close so the file on disk
// is the complete, checkpointed state (what a restarted process sees).
async function seedMarker(note) {
  const db = await boot();
  expect(db.driver).toBeTruthy();
  db.run(`CREATE TABLE IF NOT EXISTS probe_marker (id INTEGER PRIMARY KEY, note TEXT)`);
  db.run(`DELETE FROM probe_marker`);
  db.run(`INSERT INTO probe_marker (id, note) VALUES (1, ?)`, [note]);
  expect(db.get(`SELECT note FROM probe_marker WHERE id = 1`).note).toBe(note);
  db.close?.();
  expect(fs.existsSync(dataFile())).toBe(true);
  return db;
}

function captureConsole() {
  const lines = [];
  const sink = (kind) => (...args) => lines.push(`${kind}: ${args.map((a) => String(a)).join(" ")}`);
  const spies = [
    vi.spyOn(console, "error").mockImplementation(sink("error")),
    vi.spyOn(console, "warn").mockImplementation(sink("warn")),
    vi.spyOn(console, "log").mockImplementation(sink("log")),
  ];
  return {
    output: () => lines.join("\n"),
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

function preservedMainFiles() {
  return fs.readdirSync(dbDir()).filter((n) => n.startsWith("data.sqlite.corrupt-"));
}

function rmWalSiblings() {
  for (const suffix of ["-wal", "-shm"]) {
    try { fs.rmSync(`${dataFile()}${suffix}`, { force: true }); } catch {}
  }
}

// ─── 1. malformed (truncated) ───────────────────────────────────────────

describe("corrupt state database (malformed)", () => {
  it("reports the file (not the drivers), preserves the bytes and keeps serving", async () => {
    await seedMarker("SURVIVES");
    expect(fs.existsSync(dataFile())).toBe(true);

    // Measured failure shape: truncate to 1 KiB (SQLite header intact → the
    // drivers, not the static check, are what detect it).
    fs.truncateSync(dataFile(), 1024);
    rmWalSiblings();

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    // Actionable: names the file, the true cause, and the recovery paths.
    expect(out).toContain(dataFile());
    expect(out).toMatch(/STATE DATABASE IS CORRUPT \(malformed\)/);
    expect(out).toMatch(/malformed: database disk image is malformed/);
    expect(out).toContain(backupsDir());
    expect(out).toMatch(/DATA LOSS/);

    // The misleading driver-level verdict is gone for a corrupt file.
    expect(out).not.toContain("No SQLite driver available");

    // Bytes preserved at their original length, under a `.corrupt-*` name.
    const preserved = preservedMainFiles();
    expect(preserved).toHaveLength(1);
    expect(fs.statSync(path.join(dbDir(), preserved[0])).size).toBe(1024);
    expect(preserved[0]).toMatch(/^data\.sqlite\.corrupt-\d{8}-\d{6}$/);

    // Startup continued on a fresh, working DB (loud, but not fatal).
    expect(db.driver).toBeTruthy();
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["_meta", "settings", "providerConnections", "apiKeys"]));
    // ...and the damaged data is gone, which is exactly what was announced.
    expect(() => db.get(`SELECT note FROM probe_marker`)).toThrow();
  });

  it("classifies a non-SQLite (garbled) file as malformed before any driver runs", async () => {
    await seedMarker("SURVIVES");
    fs.writeFileSync(dataFile(), Buffer.alloc(512, 0x41)); // no SQLite header
    rmWalSiblings();

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).toMatch(/STATE DATABASE IS CORRUPT \(malformed\)/);
    expect(out).toMatch(/missing the "SQLite format 3" header/);
    expect(out).toContain(dataFile());
    expect(out).not.toContain("No SQLite driver available");

    const preserved = preservedMainFiles();
    expect(preserved).toHaveLength(1);
    expect(fs.statSync(path.join(dbDir(), preserved[0])).size).toBe(512);
    expect(db.driver).toBeTruthy();
  });
});

// ─── 2. empty file: never a silent reset ────────────────────────────────

describe("emptied state database (0 bytes)", () => {
  it("takes the loud path instead of silently re-applying migrations", async () => {
    await seedMarker("SURVIVES");
    fs.writeFileSync(dataFile(), ""); // `: > db/data.sqlite`
    rmWalSiblings();

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).toMatch(/STATE DATABASE IS EMPTY \(0 bytes\)/);
    expect(out).toMatch(/DATA LOSS/);
    expect(out).toContain(dataFile());
    expect(out).toContain(backupsDir());
    expect(out).not.toContain("No SQLite driver available");
    // Distinct from the malformed classification (different headline).
    expect(out).not.toMatch(/STATE DATABASE IS CORRUPT/);

    const preserved = preservedMainFiles();
    expect(preserved).toHaveLength(1);
    expect(fs.statSync(path.join(dbDir(), preserved[0])).size).toBe(0);

    // The DB was still rebuilt so the process can serve.
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toContain("settings");
  });
});

// ─── 3. backup recovery ─────────────────────────────────────────────────

describe("recovery from DATA_DIR/db/backups", () => {
  it("restores the newest usable backup and its row CONTENT is readable", async () => {
    await seedMarker("RESTORED-CONTENT");
    const backupDir = path.join(backupsDir(), "schema-0-to-1-20260101-000000");
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(dataFile(), path.join(backupDir, "data.sqlite"));

    fs.truncateSync(dataFile(), 1024);
    rmWalSiblings();
    expect(fs.existsSync(path.join(backupDir, "data.sqlite"))).toBe(true);

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).toMatch(/RESTORED from/);
    expect(out).toContain(path.join(backupDir, "data.sqlite"));
    expect(out).toMatch(/PRAGMA quick_check: ok/);
    // Nothing was silently lost: the preserved copy is still on disk.
    expect(preservedMainFiles()).toHaveLength(1);

    // Content assertion, not just "did not throw".
    const row = db.get(`SELECT note FROM probe_marker WHERE id = 1`);
    expect(row).toBeTruthy();
    expect(row.note).toBe("RESTORED-CONTENT");
  });

  it("skips an unusable backup and restores the next usable one", async () => {
    await seedMarker("OLDER-BUT-GOOD");
    const goodDir = path.join(backupsDir(), "good-20250101-000000");
    fs.mkdirSync(goodDir, { recursive: true });
    fs.copyFileSync(dataFile(), path.join(goodDir, "data.sqlite"));

    // Newest directory (mtime wins) holds garbage.
    await new Promise((r) => setTimeout(r, 1100));
    const junkDir = path.join(backupsDir(), "junk-20260101-000000");
    fs.mkdirSync(junkDir, { recursive: true });
    fs.writeFileSync(path.join(junkDir, "data.sqlite"), Buffer.alloc(900, 0x41));

    fs.truncateSync(dataFile(), 1024);
    rmWalSiblings();

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).toMatch(/backup unusable/);
    expect(out).toContain(path.join(junkDir, "data.sqlite"));
    expect(out).toContain(path.join(goodDir, "data.sqlite"));
    expect(out).toMatch(/RESTORED from/);
    expect(db.get(`SELECT note FROM probe_marker WHERE id = 1`).note).toBe("OLDER-BUT-GOOD");
  });
});

// ─── 4. negative control ────────────────────────────────────────────────

describe("healthy state database (negative control)", () => {
  it("is untouched: no rename, no banner, rows intact", async () => {
    await seedMarker("HEALTHY");
    const entriesBefore = fs.readdirSync(dbDir()).sort();

    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).not.toMatch(/STATE DATABASE IS (CORRUPT|EMPTY)/);
    expect(out).not.toMatch(/RESTORED from/);
    expect(out).not.toMatch(/DATA LOSS/);
    expect(out).not.toMatch(/backup unusable/);
    expect(preservedMainFiles()).toEqual([]);
    // The healthy path may only add the live WAL siblings — no preserved copy,
    // no renamed file (opening a WAL-mode DB always (re)creates these).
    const added = fs.readdirSync(dbDir()).filter(
      (n) => !entriesBefore.includes(n) && !["data.sqlite-wal", "data.sqlite-shm"].includes(n)
    );
    expect(added).toEqual([]);
    expect(fs.existsSync(dataFile())).toBe(true);

    expect(db.get(`SELECT note FROM probe_marker WHERE id = 1`).note).toBe("HEALTHY");
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`)).toBeTruthy();
  });

  it("a missing data.sqlite is a fresh install, not corruption", async () => {
    fs.mkdirSync(dbDir(), { recursive: true });
    const capture = captureConsole();
    let db;
    try {
      db = await boot();
    } finally {
      capture.restore();
    }
    const out = capture.output();

    expect(out).not.toMatch(/STATE DATABASE IS (CORRUPT|EMPTY)/);
    expect(out).not.toMatch(/DATA LOSS/);
    expect(preservedMainFiles()).toEqual([]);
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toContain("settings");
  });
});
