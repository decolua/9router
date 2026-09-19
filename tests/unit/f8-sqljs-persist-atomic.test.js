// F8 M-1/M-2: sql.js persist must be atomic (tmp file + rename, never a direct
// write onto the live db file), boot must refuse an unwritable target with an
// explicit error (instead of silently running in memory and losing everything),
// and SIGINT/SIGTERM listeners must NOT be registered (sibling-adapter policy).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Record every writeFileSync/renameSync that flows through the ESM "node:fs"
// import in the source graph (sqljsAdapter, paths.js, migrate.js). Everything
// else passes straight through to the real fs.
const { fsEvents } = vi.hoisted(() => ({ fsEvents: [] }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  const real = actual.default || actual;
  const proxied = new Proxy(real, {
    get(target, prop) {
      if (prop === "writeFileSync") {
        return (file, ...rest) => {
          fsEvents.push({ op: "write", file: String(file) });
          return real.writeFileSync(file, ...rest);
        };
      }
      if (prop === "renameSync") {
        return (from, to, ...rest) => {
          fsEvents.push({ op: "rename", from: String(from), to: String(to) });
          return real.renameSync(from, to, ...rest);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(real) : v;
    },
  });
  return { ...actual, default: proxied };
});

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f8-sqljs-"));
  fsEvents.length = 0;
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("sql.js atomic persist (M-1)", () => {
  it("boot persist goes through a temp file + rename, never a direct write on the db file", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const finalPath = path.join(tempDir, "data.sqlite");
    fsEvents.length = 0;
    const adapter = await createSqlJsAdapter(finalPath);
    try {
      const writes = fsEvents.filter((e) => e.op === "write");
      const renames = fsEvents.filter((e) => e.op === "rename");
      // The file must actually be written at boot (persistence self-check)...
      expect(writes.length).toBeGreaterThan(0);
      // ...never directly onto the live path (that truncates it — a crash in the
      // middle leaves a corrupt db), and some write must land via rename.
      expect(writes.some((w) => w.file === finalPath)).toBe(false);
      expect(renames.some((r) => r.to === finalPath && r.from !== finalPath)).toBe(true);
    } finally {
      adapter.close();
    }
  });

  it("boot fails EXPLICITLY when the target file is not writable (no silent in-memory mode)", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    // Parent directory does not exist → every write attempt fails. A silently
    // in-memory adapter here means every later save loses data.
    const badPath = path.join(tempDir, "no-such-dir", "data.sqlite");
    await expect(createSqlJsAdapter(badPath)).rejects.toThrow(/not writable|refusing in-memory/i);
  });

  it("close() removes its shutdown listeners and registers no signal handlers (M-2)", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const before = {
      beforeExit: process.listenerCount("beforeExit"),
      exit: process.listenerCount("exit"),
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };
    const adapter = await createSqlJsAdapter(path.join(tempDir, "data.sqlite"));
    // Signal listeners suppress Node's default kill; the shutdown coordinator
    // owns signals — the adapter must NOT add any (sibling-adapter policy).
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM);
    // Orderly-shutdown hooks ARE registered (sql.js has no WAL to recover).
    expect(process.listenerCount("beforeExit")).toBe(before.beforeExit + 1);
    expect(process.listenerCount("exit")).toBe(before.exit + 1);
    adapter.close();
    // close() drops them again — no per-adapter-instance listener leak.
    expect(process.listenerCount("beforeExit")).toBe(before.beforeExit);
    expect(process.listenerCount("exit")).toBe(before.exit);
  });

  it("re-runs of persist never leave .tmp debris next to the db file", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const filePath = path.join(tempDir, "data.sqlite");
    const adapter = await createSqlJsAdapter(filePath);
    adapter.exec("CREATE TABLE t(x)");
    adapter.run("INSERT INTO t(x) VALUES(?)", [1]);
    await new Promise((r) => setTimeout(r, 200)); // let the debounced save fire
    adapter.close();
    const leftovers = fs.readdirSync(tempDir).filter((f) => f !== "data.sqlite");
    expect(leftovers).toEqual([]);
  });

  it("data round-trips across adapter restarts on the same file", async () => {
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const filePath = path.join(tempDir, "data.sqlite");
    const a1 = await createSqlJsAdapter(filePath);
    a1.exec("CREATE TABLE t(x INTEGER)");
    a1.run("INSERT INTO t(x) VALUES(?)", [42]);
    a1.close();
    const a2 = await createSqlJsAdapter(filePath);
    expect(a2.get("SELECT x FROM t").x).toBe(42);
    a2.close();
  });
});
