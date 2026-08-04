import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";
import * as childProcess from "child_process";
import * as util from "util";

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

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args) => mockExecFile(...args),
}));

// Mock util.promisify to return an async version of our mock
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: (fn) => {
      // Return an async wrapper around mockExecFile
      return async (...args) => {
        return new Promise((resolve, reject) => {
          mockExecFile(...args, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout: stdout || "", stderr: stderr || "" });
          });
        });
      };
    },
  };
});

let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      writable: true,
    });
    // Re-import to pick up fresh mocks each run
    const mod =
      await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      writable: true,
    });
  });

  // ── Not found ─────────────────────────────────────────────────────────

  it("returns not-found when no candidate paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Checked locations:");
    expect(response.body.error).toContain(
      "Make sure Cursor IDE is installed and opened at least once.",
    );
  });

  // ── sqlite3 CLI failure ───────────────────────────────────────────────

  it("returns error when db exists but sqlite3 CLI fails", async () => {
    // First access call succeeds (db found), rest don't matter
    vi.mocked(fsPromises.access).mockResolvedValue();
    // sqlite3 CLI fails
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error("sqlite3 not found"), "", "");
    });

    const response = await GET();

    // Falls through to windowsManual fallback
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeDefined();
  });

  // ── Successful extraction ─────────────────────────────────────────────

  it("extracts tokens via sqlite3 CLI", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      const sql = args[1];
      if (sql.includes("cursorAuth/accessToken")) {
        cb(null, "test-token\n", "");
      } else if (sql.includes("cursorAuth/token")) {
        cb(null, "", "");
      } else if (sql.includes("storage.serviceMachineId")) {
        cb(null, "test-machine-id\n", "");
      } else if (sql.includes("storage.machineId")) {
        cb(null, "", "");
      } else if (sql.includes("telemetry.machineId")) {
        cb(null, "", "");
      } else {
        cb(null, "", "");
      }
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
  });

  // ── JSON string unwrapping ────────────────────────────────────────────

  it("unwraps JSON-encoded string values (normalize)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      const sql = args[1];
      if (sql.includes("cursorAuth/accessToken")) {
        cb(null, '"json-token"\n', "");
      } else if (sql.includes("storage.serviceMachineId")) {
        cb(null, '"json-machine-id"\n', "");
      } else {
        cb(null, "", "");
      }
    });

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Linux platform checks ────────────────────────────────────────────

  it("linux rejects import when cursor is not installed despite config existing", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: true,
    });

    // DB file exists
    let callCount = 0;
    vi.mocked(fsPromises.access).mockImplementation(async (path) => {
      // First calls: candidate path checks — first one succeeds
      if (String(path).includes("state.vscdb")) {
        if (callCount === 0) {
          callCount++;
          return;
        }
        throw new Error("ENOENT");
      }
      // .desktop file check fails
      if (String(path).includes("cursor.desktop")) {
        throw new Error("ENOENT");
      }
      throw new Error("ENOENT");
    });

    // `which cursor` fails
    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      if (_cmd === "which") {
        cb(new Error("not found"), "", "");
        return;
      }
      cb(null, "", "");
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(
      "Cursor config files found but Cursor IDE does not appear to be installed",
    );
  });

  // ── Unsupported/unknown platform ──────────────────────────────────────

  it("unknown platform uses linux-style default paths", async () => {
    Object.defineProperty(process, "platform", {
      value: "freebsd",
      writable: true,
    });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    // Should get the "not found" error with checked locations (linux defaults)
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain(".config/Cursor");
  });

  // ── Fallback to windowsManual ─────────────────────────────────────────

  it("falls back to windowsManual when no tokens found via CLI", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    // CLI returns empty for all keys
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "", "");
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeDefined();
  });
});
