import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import * as fsPromises from "fs/promises";
import { execFile } from "child_process";
import { createRequire } from "node:module";

// Mock next/server so the route's NextResponse.json payloads stay inspectable.
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// The route resolves execFile -> promisified promise; no sqlite3/which binary runs.
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: (fn) => (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
}));

// The route loads better-sqlite3 through CJS `require`, which vi.mock cannot
// intercept. Keep this factory for an ESM loader (post-repair) and wire the CJS
// loader/cache to the same class below.
const dbMock = vi.hoisted(() => {
  const state = {
    failure: null,
    instance: { prepare: vi.fn(), close: vi.fn() },
  };

  class MockDatabase {
    constructor() {
      if (state.failure) throw state.failure;
      return state.instance;
    }
  }

  // Support both `require("better-sqlite3")` and `{ default }` destructuring.
  MockDatabase.default = MockDatabase;
  state.MockDatabase = MockDatabase;
  return state;
});

vi.mock("better-sqlite3", () => ({ default: dbMock.MockDatabase }));

const MACOS_DB =
  "/mock/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const MACOS_INSIDERS_DB =
  "/mock/home/Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb";
const WINDOWS_DB = "/mock/appdata/Cursor/User/globalStorage/state.vscdb";
const LINUX_DB = "/mock/home/.config/Cursor/User/globalStorage/state.vscdb";
const LINUX_LOWERCASE_DB =
  "/mock/home/.config/cursor/User/globalStorage/state.vscdb";

const originalPlatform = process.platform;
const originalProcess = globalThis.process;
let proxiedProcess = null;

function setPlatform(platform) {
  try {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    // Some runtimes expose platform as a non-configurable accessor.
  }

  if (process.platform === platform) return;

  // Fallback for runtimes where the own-property override is ignored.
  proxiedProcess = new Proxy(originalProcess, {
    get(target, property, receiver) {
      if (property === "platform") return platform;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  globalThis.process = proxiedProcess;

  if (process.platform !== platform) {
    throw new Error(
      `Failed to stub process.platform: wanted ${platform}, got ${process.platform}`,
    );
  }
}

function restorePlatform() {
  if (proxiedProcess) {
    globalThis.process = originalProcess;
    proxiedProcess = null;
  }

  try {
    Object.defineProperty(originalProcess, "platform", {
      value: originalPlatform,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    // Leave the runtime's original descriptor untouched.
  }
}

const cjsRequire = createRequire(import.meta.url);
const requireShim = (id) =>
  id === "better-sqlite3" ? dbMock.MockDatabase : cjsRequire(id);
let savedRequireDescriptor;
let resolvedDatabasePath = null;
let savedDatabaseCacheEntry;

beforeAll(() => {
  savedRequireDescriptor = Object.getOwnPropertyDescriptor(globalThis, "require");
  if (savedRequireDescriptor && !savedRequireDescriptor.configurable) {
    if (savedRequireDescriptor.writable) globalThis.require = requireShim;
  } else {
    Object.defineProperty(globalThis, "require", {
      configurable: true,
      writable: true,
      value: requireShim,
    });
  }

  try {
    resolvedDatabasePath = cjsRequire.resolve("better-sqlite3");
    savedDatabaseCacheEntry = cjsRequire.cache[resolvedDatabasePath];
    cjsRequire.cache[resolvedDatabasePath] = {
      id: resolvedDatabasePath,
      filename: resolvedDatabasePath,
      loaded: true,
      exports: dbMock.MockDatabase,
    };
  } catch {
    // Package is absent in this environment; the global require shim still
    // covers the Node ESM loader.
    resolvedDatabasePath = null;
    savedDatabaseCacheEntry = undefined;
  }
});

afterAll(() => {
  if (resolvedDatabasePath) {
    if (savedDatabaseCacheEntry === undefined) {
      delete cjsRequire.cache[resolvedDatabasePath];
    } else {
      cjsRequire.cache[resolvedDatabasePath] = savedDatabaseCacheEntry;
    }
  }

  if (savedRequireDescriptor) {
    if (savedRequireDescriptor.configurable) {
      Object.defineProperty(globalThis, "require", savedRequireDescriptor);
    } else if (savedRequireDescriptor.writable) {
      globalThis.require = savedRequireDescriptor.value;
    }
  } else {
    delete globalThis.require;
  }
});

function stubExecFile(handler) {
  vi.mocked(execFile).mockImplementation((file, args, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    let result;

    try {
      result = handler(file, args);
    } catch (error) {
      done(error);
      return;
    }

    if (result instanceof Error) {
      done(result);
      return;
    }

    done(null, result ?? "", "");
  });
}

const sqliteCliUnavailable = () => new Error("sqlite3: command not found");

function exactLookup(entries) {
  return vi.fn((key) =>
    Object.prototype.hasOwnProperty.call(entries, key)
      ? { value: entries[key] }
      : undefined,
  );
}

// Exact-key tests intentionally expose only `.get`; any fuzzy `.all` attempt
// fails loudly instead of being silently tolerated.
function mockExactOnly(entries) {
  const get = exactLookup(entries);
  dbMock.instance.prepare.mockImplementation(() => ({ get }));
  return get;
}

function fuzzyRows(sql, params = []) {
  // Production may inline the pattern or bind it; classify on both.
  const haystack = `${sql} ${params.map(String).join(" ")}`;
  const rows = [];
  if (/accessToken|token/i.test(haystack)) {
    rows.push({
      key: "cursorAuth/someOtherAccessTokenKey",
      value: "fallback-token",
    });
  }
  if (/machineId/i.test(haystack)) {
    rows.push({ key: "storage.someMachineId", value: "fallback-machine" });
  }
  return rows;
}

function mockExactMissThenFuzzy(rowsForSql = fuzzyRows) {
  const get = vi.fn(() => undefined);
  dbMock.instance.prepare.mockImplementation((sql) => {
    if (String(sql).includes("LIKE")) {
      return { all: vi.fn((...params) => rowsForSql(sql, params)) };
    }
    return { get };
  });
  return get;
}

describe("GET /api/oauth/cursor/auto-import", () => {
  let GET;
  let savedAppData;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.access).mockReset();
    vi.mocked(execFile).mockReset();
    dbMock.instance.prepare.mockReset();
    dbMock.instance.close.mockReset();
    dbMock.failure = null;

    stubExecFile(sqliteCliUnavailable);
    savedAppData = process.env.APPDATA;
    setPlatform("darwin");

    const mod = await import(
      "../../src/app/api/oauth/cursor/auto-import/route.js"
    );
    GET = mod.GET;
  });

  afterEach(() => {
    if (savedAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = savedAppData;
    }
    restorePlatform();
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns the unified not-found error listing both macOS candidate paths", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Checked locations:");
    expect(response.body.error).toContain(MACOS_DB);
    expect(response.body.error).toContain(MACOS_INSIDERS_DB);
    expect(response.body.windowsManual).toBeUndefined();
  });

  it("returns a bounded diagnostic when the database exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    const failure = new Error(
      "unable to open database, token=secret-token-value",
    );
    failure.code = "SQLITE_CANTOPEN";
    dbMock.failure = failure;

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("could not open it");
    expect(response.body.error).toContain("SQLITE_CANTOPEN");
    // Raw database errors may carry token material; only the code is safe.
    expect(response.body.error).not.toContain("secret-token-value");
  });

  it("prefers a successful sqlite3 CLI result over a database-open failure", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    const failure = new Error("unable to open database");
    failure.code = "SQLITE_CANTOPEN";
    dbMock.failure = failure;
    stubExecFile((file, args) => {
      if (file !== "sqlite3") return new Error(`unexpected command: ${file}`);
      const sql = String(args[1]);
      if (sql.includes("cursorAuth/accessToken")) return "cli-token\n";
      if (sql.includes("storage.serviceMachineId")) return "cli-machine-id\n";
      return "\n";
    });

    const response = await GET();

    expect(response.body).toMatchObject({
      found: true,
      accessToken: "cli-token",
      machineId: "cli-machine-id",
    });
  });

  it("closes the database even when a query throws", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    dbMock.instance.prepare.mockImplementation((sql) => {
      if (String(sql).includes("LIKE")) {
        return { all: vi.fn(() => []) };
      }
      return {
        get: vi.fn(() => {
          throw new Error("SQLITE_CORRUPT: malformed database");
        }),
      };
    });

    const response = await GET();

    expect(dbMock.instance.close).toHaveBeenCalledTimes(1);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("SQLITE_CORRUPT");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using keyed exact-key lookups", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    const get = mockExactOnly({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body).toMatchObject({
      found: true,
      accessToken: "test-token",
      machineId: "test-machine-id",
    });
    expect(get).toHaveBeenCalledWith("cursorAuth/accessToken");
    expect(get).toHaveBeenCalledWith("storage.serviceMachineId");
    expect(dbMock.instance.close).toHaveBeenCalledTimes(1);
  });

  it("unwraps JSON-encoded string values", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockExactOnly({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });

    const response = await GET();

    expect(response.body).toMatchObject({
      found: true,
      accessToken: "json-token",
      machineId: "json-machine-id",
    });
  });

  // ── Fuzzy fallback (macOS only) ───────────────────────────────────────

  it("falls back to fuzzy LIKE lookups on macOS when exact keys are missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    const get = mockExactMissThenFuzzy();

    const response = await GET();

    expect(response.body).toMatchObject({
      found: true,
      accessToken: "fallback-token",
      machineId: "fallback-machine",
    });
    // Every exact key is attempted before the fuzzy fallback can answer.
    expect(get).toHaveBeenCalledWith("cursorAuth/accessToken");
    expect(get).toHaveBeenCalledWith("cursorAuth/token");
    expect(get).toHaveBeenCalledWith("storage.serviceMachineId");
    expect(get).toHaveBeenCalledWith("telemetry.machineId");
    expect(
      dbMock.instance.prepare.mock.calls.some(([sql]) =>
        String(sql).includes("LIKE"),
      ),
    ).toBe(true);
  });

  it("returns login-prompt error when tokens are missing even after fallback", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockExactMissThenFuzzy(() => []);

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Please login to Cursor IDE first");
    expect(response.body.windowsManual).toBeUndefined();
  });

  // ── Platform-specific flows ───────────────────────────────────────────

  it("keeps the Windows manual-paste flow when no tokens can be extracted", async () => {
    setPlatform("win32");
    process.env.APPDATA = "/mock/appdata";
    vi.mocked(fsPromises.access).mockResolvedValue();
    dbMock.instance.prepare.mockImplementation(() => ({
      get: vi.fn(() => undefined),
    }));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBe(WINDOWS_DB);
    expect(response.body.error).toBeUndefined();
    // Windows keeps the current flow: no macOS fuzzy pass.
    expect(
      dbMock.instance.prepare.mock.calls.some(([sql]) =>
        String(sql).includes("LIKE"),
      ),
    ).toBe(false);
  });

  it("returns the unified not-found error listing both Linux candidate paths", async () => {
    setPlatform("linux");
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Checked locations:");
    expect(response.body.error).toContain(LINUX_DB);
    expect(response.body.error).toContain(LINUX_LOWERCASE_DB);
    expect(response.body.windowsManual).toBeUndefined();
  });

  it("rejects leftover Linux config when Cursor is not actually installed", async () => {
    setPlatform("linux");
    vi.mocked(fsPromises.access).mockImplementation(async (target) => {
      if (
        typeof target === "string" &&
        target.endsWith("cursor.desktop")
      ) {
        throw new Error("ENOENT");
      }
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("does not appear to be installed");
    expect(execFile).toHaveBeenCalledWith(
      "which",
      ["cursor"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    expect(dbMock.instance.prepare).not.toHaveBeenCalled();
  });

  it("unsupported platform returns 400", async () => {
    setPlatform("freebsd");
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(400);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toBe("Unsupported platform");
  });
});
