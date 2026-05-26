import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateProvidersOnStartup, normalizeErrorCode } from "../providerStartupValidator";

// Mock dependencies
vi.mock("@/lib/db/repos/connectionsRepo", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("../providerProbe", () => ({
  probeProviderConnection: vi.fn(),
}));

import { getProviderConnections, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { probeProviderConnection } from "../providerProbe";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateProvidersOnStartup", () => {
  it("returns early when no connections exist", async () => {
    getProviderConnections.mockResolvedValueOnce([]);
    const result = await validateProvidersOnStartup();
    expect(result).toBeUndefined();
    expect(probeProviderConnection).not.toHaveBeenCalled();
  });

  it("writes testStatus=success for valid probe", async () => {
    getProviderConnections.mockResolvedValueOnce([
      { id: "c1", provider: "openai", name: "OpenAI" },
    ]);
    probeProviderConnection.mockResolvedValueOnce({ valid: true, skipped: false, statusCode: 200, error: null });
    updateProviderConnection.mockResolvedValueOnce({});

    const result = await validateProvidersOnStartup();

    expect(updateProviderConnection).toHaveBeenCalledWith("c1", expect.objectContaining({
      testStatus: "success",
      lastError: null,
    }));
    expect(result.valid).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("writes testStatus=failed for invalid probe", async () => {
    getProviderConnections.mockResolvedValueOnce([
      { id: "c2", provider: "anthropic", name: "Anthropic" },
    ]);
    probeProviderConnection.mockResolvedValueOnce({ valid: false, skipped: false, statusCode: 401, error: "HTTP 401" });
    updateProviderConnection.mockResolvedValueOnce({});

    const result = await validateProvidersOnStartup();

    expect(updateProviderConnection).toHaveBeenCalledWith("c2", expect.objectContaining({
      testStatus: "failed",
      lastError: "HTTP 401",
      errorCode: "AUTH",
    }));
    expect(result.failed).toBe(1);
  });

  it("does not call updateProviderConnection for skipped providers", async () => {
    getProviderConnections.mockResolvedValueOnce([
      { id: "c3", provider: "opencode", name: "OpenCode" },
    ]);
    probeProviderConnection.mockResolvedValueOnce({ valid: true, skipped: true, reason: "no-auth provider" });

    const result = await validateProvidersOnStartup();

    expect(updateProviderConnection).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.valid).toBe(0);
  });

  it("handles DB error gracefully and returns undefined", async () => {
    getProviderConnections.mockRejectedValueOnce(new Error("DB locked"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await validateProvidersOnStartup();

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Startup validation"),
      "DB locked"
    );
    consoleSpy.mockRestore();
  });

  it("continues when individual DB write fails", async () => {
    getProviderConnections.mockResolvedValueOnce([
      { id: "c4", provider: "openai", name: "OpenAI" },
    ]);
    probeProviderConnection.mockResolvedValueOnce({ valid: true, skipped: false, statusCode: 200, error: null });
    updateProviderConnection.mockRejectedValueOnce(new Error("write failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await validateProvidersOnStartup();

    expect(result.valid).toBe(1); // probe succeeded even if DB write failed
    warnSpy.mockRestore();
  });

  it("processes connections in batches of 5", async () => {
    const connections = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      provider: "openai",
      name: `OpenAI ${i}`,
    }));
    getProviderConnections.mockResolvedValueOnce(connections);
    probeProviderConnection.mockResolvedValue({ valid: true, skipped: false, statusCode: 200, error: null });
    updateProviderConnection.mockResolvedValue({});

    const result = await validateProvidersOnStartup();

    expect(probeProviderConnection).toHaveBeenCalledTimes(12);
    expect(result.total).toBe(12);
    expect(result.valid).toBe(12);
  });
});

describe("normalizeErrorCode", () => {
  it("returns null for a valid probe", () => {
    expect(normalizeErrorCode({ valid: true })).toBeNull();
  });

  it("returns null for null/empty input", () => {
    expect(normalizeErrorCode(null)).toBeNull();
    expect(normalizeErrorCode(undefined)).toBeNull();
  });

  it("maps 401 to AUTH", () => {
    expect(normalizeErrorCode({ valid: false, statusCode: 401 })).toBe("AUTH");
  });

  it("maps 403 to AUTH", () => {
    expect(normalizeErrorCode({ valid: false, statusCode: 403 })).toBe("AUTH");
  });

  it("maps 429 to 429", () => {
    expect(normalizeErrorCode({ valid: false, statusCode: 429 })).toBe("429");
  });

  it("maps 5xx codes to 5XX", () => {
    expect(normalizeErrorCode({ valid: false, statusCode: 500 })).toBe("5XX");
    expect(normalizeErrorCode({ valid: false, statusCode: 503 })).toBe("5XX");
    expect(normalizeErrorCode({ valid: false, statusCode: 599 })).toBe("5XX");
  });

  it("maps other 4xx codes to a numeric string", () => {
    expect(normalizeErrorCode({ valid: false, statusCode: 400 })).toBe("400");
    expect(normalizeErrorCode({ valid: false, statusCode: 404 })).toBe("404");
  });

  it("maps timeout to TIMEOUT", () => {
    expect(normalizeErrorCode({ valid: false, error: "timeout" })).toBe("TIMEOUT");
  });

  it("maps network error (no statusCode) to NET", () => {
    expect(normalizeErrorCode({ valid: false, error: "ENOTFOUND" })).toBe("NET");
  });

  it("returns null when no usable signal is present", () => {
    expect(normalizeErrorCode({ valid: false })).toBeNull();
  });
});
