import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

// Aligned with the re-architected route (#368 drop sql.js, #411 better-sqlite3 → sqlite3
// CLI → manual fallback). Deliberately-removed legacy behaviors are NOT tested anymore:
// fuzzy LIKE key matching, "Please login to Cursor IDE first", "Unsupported platform" 400,
// and the SQLITE_CANTOPEN "could not open it" message — the route no longer promises them.
//
// better-sqlite3 is a native module that Vitest externalizes, so `vi.mock("better-sqlite3")`
// does NOT intercept the route's `require("better-sqlite3")` (this is why the previous mock
// silently fell through). We therefore exercise the REAL better-sqlite3 against a REAL temp
// SQLite db placed at the platform's candidate path under a mocked $HOME. Only os.homedir
// and child_process (sqlite3 CLI / `which cursor`) are mocked.

const hoisted = vi.hoisted(() => ({ home: "" }));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  },
}));

// Preserve the real os (tmpdir etc. are used by the test itself); only override homedir.
vi.mock("os", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => hoisted.home },
    homedir: () => hoisted.home,
  };
});

// No sqlite3 CLI and no `cursor` binary in the test env → reject so the route can't shell out.
vi.mock("child_process", () => ({
  execFile: vi.fn((...args) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb(new Error("mock: command unavailable"));
  }),
}));

/** Build the route's primary candidate db path for a platform under the mocked $HOME. */
function candidateDbPath(home, platform) {
  if (platform === "darwin") {
    return path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
  }
  // linux default
  return path.join(home, ".config/Cursor/User/globalStorage/state.vscdb");
}

/** Create a real SQLite state.vscdb with an itemTable holding the given key→value rows. */
function writeCursorDb(dbPath, rows) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
  const insert = db.prepare("INSERT INTO itemTable (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(rows)) insert.run(key, value);
  db.close();
}

let GET;
const originalPlatform = process.platform;
let tmpHome;

describe("GET /api/oauth/cursor/auto-import", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cursor-"));
    hoisted.home = tmpHome;
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it("returns not-found listing checked locations when no db exists", async () => {
    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
  });

  it("extracts tokens from the Cursor SQLite db using exact keys", async () => {
    writeCursorDb(candidateDbPath(tmpHome, "darwin"), {
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
  });

  it("unwraps JSON-encoded string values", async () => {
    writeCursorDb(candidateDbPath(tmpHome, "darwin"), {
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("falls through to manual paste when tokens are missing and CLI is unavailable", async () => {
    // db exists but has no relevant keys → better-sqlite3 yields nulls, sqlite3 CLI mock rejects.
    writeCursorDb(candidateDbPath(tmpHome, "darwin"), { "some/unrelated/key": "x" });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeTruthy();
  });

  it("linux: config db present but Cursor not installed → not-found", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    // db present at the linux candidate, but `which cursor` (mocked reject) and the
    // cursor.desktop marker (absent) both fail the install check.
    writeCursorDb(candidateDbPath(tmpHome, "linux"), {
      "cursorAuth/accessToken": "t",
      "storage.serviceMachineId": "m",
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("does not appear to be installed");
  });
});
