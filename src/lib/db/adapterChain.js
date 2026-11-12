// SQLite adapter chain — ONE implementation, shared by the driver bootstrap
// (driver.js) and the corrupt-state-database path (integrity.js).
//
// Order per runtime:
//   Bun:  bun:sqlite → sql.js
//   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
//
// createAdapterWithChain NEVER throws. It returns the first adapter that opens
// successfully plus the FULL attempt list, so the caller can tell the two
// failure shapes apart before reporting anything:
//   * a missing driver MODULE (status "error", not corruption) → report each
//     `[DB] <driver> unavailable: …` line and fall through, as before;
//   * a damaged DATABASE FILE (status "error" + isCorruptionError) → the file
//     is the cause, not the drivers (see integrity.js).

// Raw SQLite result codes (node:sqlite exposes the number, better-sqlite3 the
// name in err.code, sql.js only the message).
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

const CORRUPTION_MESSAGE_RE =
  /database disk image is malformed|file is not a database|file is encrypted or is not a database|database schema is malformed/i;

// True when the error means "this file is not a usable SQLite database".
// Deliberately narrow: a missing better-sqlite3 module ("Cannot find module …")
// must NOT be classified as corruption, or the driver-fallback path would be
// mistaken for a damaged file.
export function isCorruptionError(err) {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return true;
  if (err.errcode === SQLITE_CORRUPT || err.errcode === SQLITE_NOTADB) return true;
  return CORRUPTION_MESSAGE_RE.test(String(err.message ?? ""));
}

// Which attempts from a chain run failed because the FILE is damaged.
export function corruptionFailures(attempts = []) {
  return attempts.filter((a) => a.status === "error" && isCorruptionError(a.error));
}

function nodeVersion() {
  const [maj, min] = String(process.versions.node || "0.0.0").split(".").map((n) => parseInt(n, 10));
  return { maj: Number.isFinite(maj) ? maj : 0, min: Number.isFinite(min) ? min : 0 };
}

// Ordered plan for the current runtime. `skip` entries are recorded but never
// attempted — they are not failures and must not produce an "unavailable"
// warning (that is exactly how the old try* helpers behaved).
export function chainPlan() {
  const { maj, min } = nodeVersion();
  const isBun = !!process.versions.bun;
  const plan = [
    {
      driver: "bun:sqlite",
      skip: isBun ? null : "Bun runtime only",
      load: async (file) => {
        const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
        return await createBunSqliteAdapter(file);
      },
    },
    {
      driver: "better-sqlite3",
      // Skip on Bun (native addon unsupported) and on Node >= 24 (the addon
      // SIGSEGVs on load there — a process-level crash try/catch cannot catch).
      skip: isBun ? "Bun runtime (native addon unsupported)" : maj >= 24 ? "Node >= 24 (native addon SIGSEGV)" : null,
      load: async (file) => {
        const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
        return createBetterSqliteAdapter(file);
      },
    },
    {
      driver: "node:sqlite",
      skip:
        isBun ? "Bun runtime (no node:sqlite)"
        : maj < 22 || (maj === 22 && min < 5) ? "Node < 22.5"
        : null,
      load: async (file) => {
        const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
        return await createNodeSqliteAdapter(file);
      },
    },
    {
      driver: "sql.js",
      skip: null,
      load: async (file) => {
        const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
        return await createSqlJsAdapter(file);
      },
    },
  ];
  return plan;
}

// Try every applicable driver in order, stopping at the first success.
// Returns { adapter, attempts } where attempts is the ordered list of
// { driver, status: "ok"|"skipped"|"error", adapter?, error?, reason? }.
export async function createAdapterWithChain(filePath) {
  const attempts = [];
  for (const step of chainPlan()) {
    if (step.skip) {
      attempts.push({ driver: step.driver, status: "skipped", reason: step.skip });
      continue;
    }
    try {
      const adapter = await step.load(filePath);
      if (!adapter) {
        attempts.push({ driver: step.driver, status: "error", error: new Error("adapter factory returned nothing") });
        continue;
      }
      attempts.push({ driver: step.driver, status: "ok", adapter });
      return { adapter, attempts };
    } catch (e) {
      attempts.push({ driver: step.driver, status: "error", error: e });
    }
  }
  return { adapter: null, attempts };
}

// The exact operator-visible text for "no driver could be used" (unchanged).
export const NO_DRIVER_MESSAGE = "[DB] No SQLite driver available (bun/better/node/sql.js all failed)";

// Per-driver warnings, byte-identical to the ones the old try* helpers printed.
export function reportDriverFailures(attempts = [], log = console) {
  for (const a of attempts) {
    if (a.status === "error") log.warn(`[DB] ${a.driver} unavailable: ${a.error.message}`);
  }
}
