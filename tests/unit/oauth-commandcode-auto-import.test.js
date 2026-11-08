import { describe, it, expect, vi, beforeEach } from "vitest";

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
  readFile: vi.fn(),
  constants: { R_OK: 4 },
}));

import * as fsPromises from "fs/promises";
import { GET } from "../../src/app/api/oauth/commandcode/auto-import/route.js";

describe("GET /api/oauth/commandcode/auto-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns found: false when auth.json does not exist", async () => {
    fsPromises.access.mockRejectedValue(new Error("ENOENT"));

    const response = await GET();
    const data = await response.json();

    expect(data.found).toBe(false);
    expect(data.error).toContain("Command Code auth file not found");
  });

  it("returns credentials when auth.json exists with valid apiKey", async () => {
    fsPromises.access.mockResolvedValue(undefined);
    fsPromises.readFile.mockResolvedValue(
      JSON.stringify({
        apiKey: "user_abc123xyz",
        userId: "usr_456",
        userName: "Alwa Dev",
        keyName: "default",
        authenticatedAt: "2026-11-08T15:30:00.000Z",
      })
    );

    const response = await GET();
    const data = await response.json();

    expect(data.found).toBe(true);
    expect(data.apiKey).toBe("user_abc123xyz");
    expect(data.userId).toBe("usr_456");
    expect(data.userName).toBe("Alwa Dev");
    expect(data.keyName).toBe("default");
  });

  it("returns found: false when apiKey is missing", async () => {
    fsPromises.access.mockResolvedValue(undefined);
    fsPromises.readFile.mockResolvedValue(
      JSON.stringify({
        userId: "usr_456",
      })
    );

    const response = await GET();
    const data = await response.json();

    expect(data.found).toBe(false);
    expect(data.error).toContain("No apiKey found");
  });
});
