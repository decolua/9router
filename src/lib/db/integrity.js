// State-DB integrity — detect, preserve and recover a damaged `data.sqlite`.
//
// Why this module exists: the real state DB (DATA_DIR/db/data.sqlite, see
// paths.js → DATA_FILE) is the only copy of provider connections, API keys,
// settings and usage. Before this module, all three damage shapes were
// mishandled:
//
//   * truncated / garbled  → every driver threw "database disk image is
//     malformed", and driver.js then reported `[DB] No SQLite driver
//     available (…)`. The message blamed the DRIVERS, never the file; the
//     bytes were left in place and backups/ was never consulted.
//   * emptied (`: > data.sqlite`) → SQLite treats a 0-byte file as a brand new
//     database: migrations were re-applied, the previous schema was gone and
//     NOTHING was logged. Total silent data loss.
//
// The contract implemented here:
//   1. DETECT   — a damaged file is classified separately from a missing driver
//                 module, before anything is opened (static header + size) and,
//                 for a file with a valid header, from the drivers' own
//                 corruption errors.
//   2. PRESERVE — the damaged bytes are RENAMED to
//                 `data.sqlite.corrupt-<timestamp>` (plus -wal/-shm siblings).
//                 They are never overwritten in place and never deleted.
//   3. RESTORE  — if a usable `data.sqlite` exists under DATA_DIR/db/backups/*/
//                 (validated exactly like the live file), the newest one is
//                 restored and reported loudly. Otherwise the app continues on
//                 a fresh DB with a prominent operator message — data loss is
//                 never silent.
//
// Dependency-free (node:fs / node:path + the existing adapters only).

import fs from "node:fs";
import path from "node:path";
import { timestampSlug } from "./version.js";
import {
  createAdapterWithChain,
  corruptionFailures,
  reportDriverFailures,
  NO_DRIVER_MESSAGE,
} from "./adapterChain.js";

// Every SQLite file (including one written by sql.js) starts with this.
export const SQLITE_MAGIC = "SQLite format 3\u0000";

// Suffix marker required by the recovery contract / operator docs.
export const CORRUPT_SUFFIX = ".corrupt-";

// ─── Detection ───────────────────────────────────────────────────────────

export function readSqliteHeader(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return { ok: read === 16 && buf.toString("latin1") === SQLITE_MAGIC, bytes: read, head: buf.toString("latin1") };
  } catch (e) {
    return { ok: false, bytes: 0, head: "", error: e };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

// Cheap, driver-free classification of the live state file.
//   missing    → nothing to do (fresh install, or the operator deleted it)
//   empty      → EXISTS but is 0 bytes: a state DB is never legitimately empty
//                (opening a fresh path and running PRAGMA_SQL writes a 4 KiB
//                header immediately), so something emptied it.
//   headerless → non-zero length without the SQLite magic (garbled / not a DB)
//   present    → plausible SQLite file; only the drivers can say more.
export function classifyStateFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { state: "missing", size: 0, kind: null, detail: "file does not exist" };
  }
  if (!stat.isFile()) {
    return { state: "missing", size: stat.size, kind: null, detail: "not a regular file" };
  }
  if (stat.size === 0) {
    return {
      state: "empty",
      size: 0,
      kind: "empty",
      detail: "the file exists but is 0 bytes (a state database is never legitimately empty)",
    };
  }
  const head = readSqliteHeader(filePath);
  if (!head.ok) {
    return {
      state: "headerless",
      size: stat.size,
      kind: "malformed",
      detail: `missing the "SQLite format 3" header (${stat.size} bytes of non-database content)`,
    };
  }
  return { state: "present", size: stat.size, kind: null, detail: `${stat.size} bytes` };
}

// ─── Preservation ────────────────────────────────────────────────────────

function uniquePath(base) {
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot find a free preserved name for ${base}`);
}

// Rename the damaged file (and its -wal/-shm siblings) out of the way.
// Returns { stamp, preserved: [paths], failures: [{from, error}] }.
export function preserveStateFile(filePath) {
  const stamp = timestampSlug();
  const preserved = [];
  const failures = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${filePath}${suffix}`;
    if (!fs.existsSync(from)) continue;
    try {
      const to = uniquePath(`${from}${CORRUPT_SUFFIX}${stamp}`);
      fs.renameSync(from, to);
      preserved.push(to);
    } catch (e) {
      failures.push({ from, error: e });
    }
  }
  return { stamp, preserved, failures };
}

// ─── Backups ─────────────────────────────────────────────────────────────

// Newest-first list of `<backupsDir>/<label>/data.sqlite` candidates.
export function listBackupCandidates(backupsDir) {
  let entries;
  try {
    entries = fs.readdirSync(backupsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const file = path.join(backupsDir, e.name, "data.sqlite");
      let mtime = 0;
      let size = 0;
      try {
        const st = fs.statSync(file);
        if (st.isFile()) { mtime = st.mtimeMs; size = st.size; }
      } catch {}
      return { dir: path.join(backupsDir, e.name), file, mtime, size };
    })
    .filter((c) => c.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime);
}

// Run `PRAGMA quick_check` through whatever adapter opened the file.
// Returns the verdict string ("ok" when healthy).
function quickCheck(adapter) {
  let row;
  try {
    row = adapter.get("PRAGMA quick_check");
  } catch (e) {
    try {
      row = adapter.all("PRAGMA quick_check")?.[0];
    } catch {
      return `quick_check failed: ${e.message}`;
    }
  }
  if (!row) return "quick_check returned no rows";
  const value = Object.values(row)[0];
  return value === undefined || value === null ? "quick_check returned no value" : String(value);
}

// Validate a candidate DB file the same way the live file is judged: it must be
// a non-empty SQLite file, some driver must open it, and quick_check must pass.
// Opens/closes its own adapter; never writes to the file it validates beyond
// what opening a WAL-mode DB does (callers validate a throwaway COPY).
export async function validateStateFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return { ok: false, detail: `unreadable: ${e.message}` };
  }
  if (stat.size === 0) return { ok: false, detail: "0 bytes" };
  if (!readSqliteHeader(filePath).ok) return { ok: false, detail: "missing the SQLite header" };

  const { adapter, attempts } = await createAdapterWithChain(filePath);
  if (!adapter) {
    const first = attempts.find((a) => a.status === "error");
    return { ok: false, detail: `no driver could open it${first ? ` (${first.error.message})` : ""}` };
  }
  try {
    const verdict = quickCheck(adapter);
    return verdict === "ok" ? { ok: true, detail: "PRAGMA quick_check: ok" } : { ok: false, detail: `PRAGMA quick_check: ${verdict}` };
  } finally {
    try { adapter.close?.(); } catch {}
  }
}

// ─── Recovery orchestration ──────────────────────────────────────────────

function fmtBytes(n) {
  return `${n} bytes`;
}

function banner(log, lines) {
  log.error("[DB] ⚠️  " + lines[0]);
  for (const line of lines.slice(1)) log.error("[DB]     " + line);
}

// Open the state database, recovering from a damaged file first when needed.
// Returns a live adapter. Throws NO_DRIVER_MESSAGE only when the drivers
// themselves are unusable (exactly as before).
export async function openStateDatabase({ dataFile, backupsDir, log = console }) {
  const verdict = classifyStateFile(dataFile);

  // Healthy or absent → unchanged behaviour: open through the chain.
  if (verdict.state === "missing") return await openChain(dataFile, log);

  if (verdict.state === "present") {
    const { adapter, attempts } = await createAdapterWithChain(dataFile);
    if (adapter) {
      reportDriverFailures(attempts, log);
      return adapter;
    }
    const corrupt = corruptionFailures(attempts);
    if (!corrupt.length) {
      // Not the file's fault (e.g. every driver module missing) — keep the
      // original reporting exactly as it was.
      reportDriverFailures(attempts, log);
      throw new Error(NO_DRIVER_MESSAGE);
    }
    return await recover({ dataFile, backupsDir, log, verdict, cause: corrupt[corrupt.length - 1].error });
  }

  // empty | headerless — damaged before any driver is involved.
  return await recover({ dataFile, backupsDir, log, verdict, cause: null });
}

async function openChain(dataFile, log) {
  const { adapter, attempts } = await createAdapterWithChain(dataFile);
  if (!adapter) {
    reportDriverFailures(attempts, log);
    throw new Error(NO_DRIVER_MESSAGE);
  }
  reportDriverFailures(attempts, log);
  return adapter;
}

async function recover({ dataFile, backupsDir, log, verdict, cause }) {
  const kind = verdict.kind || "malformed";
  const headline =
    kind === "empty"
      ? "STATE DATABASE IS EMPTY (0 bytes) — startup is NOT treating this as a fresh install"
      : "STATE DATABASE IS CORRUPT (malformed) — startup is NOT treating this as a fresh install";
  const detected =
    cause
      ? `malformed: ${cause.message}${cause.code ? ` (${cause.code})` : ""}`
      : `${kind}: ${verdict.detail}`;

  banner(log, [headline, `file      : ${dataFile}`, `detected  : ${detected}`]);

  // 1. Preserve the damaged bytes (never in place, never deleted).
  //    preserveStateFile() handles the main file first, so preserved[0] is it.
  const { preserved, failures } = preserveStateFile(dataFile);
  if (failures.length) {
    for (const f of failures) log.error(`[DB]     ⚠️  could not preserve ${f.from}: ${f.error.message}`);
    // Without moving the damaged file away, recovery would only damage it further.
    throw new Error(
      `[DB] STATE DATABASE IS ${kind.toUpperCase()} and could not be moved aside (${failures[0].error.message}). ` +
      `Stop the app, move or repair ${dataFile} manually, then restart.`
    );
  }
  log.error(`[DB]     preserved : ${preserved[0] ?? "(no file to preserve)"}${preserved.length > 1 ? ` (+${preserved.length - 1} sibling file(s))` : ""} — kept, never overwritten`);
  log.error(`[DB]     backups   : ${backupsDir}`);

  // 2. Restore the newest usable backup.
  const candidates = listBackupCandidates(backupsDir);
  for (const candidate of candidates) {
    const tmp = `${dataFile}.restore-${process.pid}-${Date.now()}`;
    try {
      fs.copyFileSync(candidate.file, tmp);
    } catch (e) {
      log.error(`[DB]     backup unusable (copy failed: ${e.message}): ${candidate.file}`);
      continue;
    }
    // Validate the exact bytes we are about to serve.
    const check = await validateStateFile(tmp);
    if (!check.ok) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      log.error(`[DB]     backup unusable (${check.detail}) [${fmtBytes(candidate.size)}]: ${candidate.file}`);
      continue;
    }
    try {
      fs.renameSync(tmp, dataFile);
    } catch (e) {
      log.error(`[DB]     backup unusable (install failed: ${e.message}): ${candidate.file}`);
      try { fs.rmSync(tmp, { force: true }); } catch {}
      continue;
    }
    for (const sibling of ["-wal", "-shm"]) {
      try { fs.rmSync(`${tmp}${sibling}`, { force: true }); } catch {}
      try { fs.rmSync(`${dataFile}${sibling}`, { force: true }); } catch {}
    }
    const adapter = await openChain(dataFile, log);
    banner(log, [
      `action    : RESTORED from ${candidate.file} (${check.detail})`,
      `note      : writes newer than that backup are not in it; the damaged file above is kept for inspection.`,
    ]);
    return adapter;
  }

  // 3. Nothing usable — continue on a fresh DB, loudly.
  banner(log, [
    `action    : NO usable backup found under ${backupsDir} — starting from a FRESH EMPTY database.`,
    `⚠️  DATA LOSS: provider connections, API keys and settings from the damaged file are NOT loaded.`,
    `recovery  : stop the app, then put a good data.sqlite back at`,
    `            ${dataFile}`,
    `            (or a backup at ${path.join(backupsDir, "<dir>", "data.sqlite")}) and start it again.`,
    `            The damaged bytes are preserved at ${preserved[0] ?? "(nothing preserved)"}`,
  ]);
  return await openChain(dataFile, log);
}
