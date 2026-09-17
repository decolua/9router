import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));
let mockExecFileHandler = null;
const mockExecFile = vi.fn((cmd, args, options, callback) => {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  if (mockExecFileHandler) {
    return mockExecFileHandler(cmd, args, options, callback);
  }
  // Default mock execFile behavior: cursor binary present, sqlite3 CLI fails
  if (cmd === "which" && args[0] === "cursor") {
    callback(null, "/usr/bin/cursor", "");
    return;
  }
  callback(new Error("Command failed"), "", "");
});

mockExecFile[Symbol.for("nodejs.util.promisify.custom")] = (
  cmd,
  args,
  options,
) => {
  return new Promise((resolve, reject) => {
    mockExecFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
};

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

// Shared mock DB instance
const mockDbInstance = {
  prepare: vi.fn(),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Helper to set up mock DB key-value pairs
const setupMockDbKeys = (keyMap) => {
  mockDbInstance.prepare.mockImplementation(() => ({
    get: vi.fn((key) => {
      if (key in keyMap) {
        return { value: keyMap[key] };
      }
      return undefined;
    }),
  }));
};

// Mock better-sqlite3 module so both CJS require and ESM import work
const MockDatabase = function MockDatabase() {
  if (mockDbInstance.__throwOnConstruct) {
    throw new Error("SQLITE_CANTOPEN");
  }
  return mockDbInstance;
};
MockDatabase.prototype = {};

vi.mock("better-sqlite3", () => {
  return {
    default: MockDatabase,
    __esModule: true,
  };
});
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbInstance.__throwOnConstruct = false;
    setupMockDbKeys({});

    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });

    const mod = await import(
      "../../src/app/api/oauth/cursor/auto-import/route.js"
    );
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  });

  // ── Candidate Paths & Probing ──────────────────────────────────────────

  it("returns not-found with candidate paths when no macOS cursor db is accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
    expect(response.body.error).toContain("Library/Application Support/Cursor");
  });

  it("returns not-found with candidate paths when no Windows cursor db is accessible", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
    });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Checked locations:");
    expect(response.body.error).toContain("globalStorage");
  });

  it("probes Unix candidate paths when on Linux or other Unix platforms", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
    });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor");
  });

  // ── Linux Installation Guard ──────────────────────────────────────────

  it("on Linux, skips auto-import if DB exists but Cursor IDE is not installed", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
    });

    // DB file exists
    vi.mocked(fsPromises.access).mockImplementation(async (path) => {
      if (path.includes(".config/Cursor")) return;
      throw new Error("ENOENT");
    });

    // `which cursor` fails
    mockExecFileHandler = (cmd, args, options, callback) => {
      callback(new Error("which failed"), "", "");
    };

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(
      "Cursor config files found but Cursor IDE does not appear to be installed"
    );
  });

  it("on Linux, proceeds with import if Cursor is installed via which binary", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
    });

    vi.mocked(fsPromises.access).mockResolvedValue();
    setupMockDbKeys({
      "cursorAuth/accessToken": "linux-token",
      "storage.serviceMachineId": "linux-machine",
    });

    mockExecFileHandler = (cmd, args, options, callback) => {
      if (cmd === "which" && args[0] === "cursor") {
        callback(null, "/usr/bin/cursor", "");
        return;
      }
      callback(new Error("Command failed"), "", "");
    };

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("linux-token");
    expect(response.body.machineId).toBe("linux-machine");
  });

  // ── Driver Strategy & Exact Key Priority ──────────────────────────────

  it("extracts tokens using exact keys with driver strategy", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    setupMockDbKeys({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("respects exact-key priority order when multiple keys match", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    setupMockDbKeys({
      "cursorAuth/accessToken": "primary-token",
      "cursorAuth/token": "secondary-token",
      "storage.serviceMachineId": "primary-machine",
      "storage.machineId": "secondary-machine",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("primary-token");
    expect(response.body.machineId).toBe("primary-machine");
  });

  it("falls back to secondary exact keys when primary exact keys are missing", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    setupMockDbKeys({
      "cursorAuth/token": "fallback-token",
      "telemetry.machineId": "fallback-machine",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  // ── JSON Normalization ────────────────────────────────────────────────

  it("unwraps JSON-encoded string values and passes through plain strings", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    setupMockDbKeys({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": "plain-machine-id",
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("plain-machine-id");
  });

  // ── Resource Management & DB Closure ─────────────────────────────────

  it("closes database connection in finally block even when queries throw", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.prepare.mockImplementation(() => {
      throw new Error("DB Query Failed");
    });

    await GET();

    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  // ── Fallback Chain: Driver → CLI → Manual ─────────────────────────────

  it("falls back to sqlite3 CLI when better-sqlite3 driver throws", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    mockExecFileHandler = (cmd, args, options, callback) => {
      if (cmd === "sqlite3") {
        const sql = args[1] || "";
        if (sql.includes("cursorAuth/accessToken")) {
          callback(null, "cli-token\n", "");
          return;
        }
        if (sql.includes("storage.serviceMachineId")) {
          callback(null, "cli-machine-id\n", "");
          return;
        }
      }
      callback(new Error("command failed"), "", "");
    };
    const response = await GET();
    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("cli-token");
    expect(response.body.machineId).toBe("cli-machine-id");
  });

  it("falls back to CLI strategy when better-sqlite3 module is completely missing or fails to import", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();

    // Simulate true import resolution rejection for better-sqlite3
    vi.doMock("better-sqlite3", () => {
      throw new Error("Cannot find module 'better-sqlite3'");
    });
    vi.resetModules();
    const { GET: getFn } = await import(
      "../../src/app/api/oauth/cursor/auto-import/route.js"
    );

    mockExecFileHandler = (cmd, args, options, callback) => {
      if (cmd === "sqlite3") {
        const sql = args[1] || "";
        if (sql.includes("cursorAuth/accessToken")) {
          callback(null, "cli-absent-token\n", "");
          return;
        }
        if (sql.includes("storage.serviceMachineId")) {
          callback(null, "cli-absent-machine\n", "");
          return;
        }
      }
      callback(new Error("command failed"), "", "");
    };

    const response = await getFn();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("cli-absent-token");
    expect(response.body.machineId).toBe("cli-absent-machine");

    // Restore standard better-sqlite3 mock for clean module registry
    vi.doMock("better-sqlite3", () => ({
      default: MockDatabase,
      __esModule: true,
    }));
    vi.resetModules();
  });

  it("falls back to manual prompt when both driver and CLI fail", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    mockExecFileHandler = (cmd, args, options, callback) => {
      callback(new Error("CLI not installed"), "", "");
    };

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeDefined();
  });

  // ── Non-Standard Platforms ─────────────────────────────────────────────

  it("handles non-standard platform gracefully via fallback config paths", async () => {
    Object.defineProperty(process, "platform", {
      value: "freebsd",
      writable: true,
    });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor");
  });
});
