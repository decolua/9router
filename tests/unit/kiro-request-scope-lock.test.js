import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(async () => {}),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "kiro-a",
    provider: "kiro",
    name: "kiro-a",
    backoffLevel: 0,
  }]);
});

describe("Kiro request-scoped context errors", () => {
  it.each([
    "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
    "input is too long for this model",
  ])("does not write a model/account lock for %s", async (message) => {
    const result = await markAccountUnavailable(
      "kiro-a",
      400,
      message,
      "kiro",
      "claude-opus-4.8",
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps 429 model locking and account fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));
    try {
      const result = await markAccountUnavailable(
        "kiro-a",
        429,
        "rate limit exceeded",
        "kiro",
        "claude-opus-4.8",
      );

      expect(result.shouldFallback).toBe(true);
      expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
        "kiro-a",
        expect.objectContaining({
          "modelLock_claude-opus-4.8": expect.any(String),
          testStatus: "unavailable",
          errorCode: 429,
          backoffLevel: 1,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
