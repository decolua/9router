import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
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
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

describe("Precise resetsAtMs cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("honors exact resetsAtMs for codebuddy without truncating to 30m", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-16T10:00:00.000Z");
    vi.setSystemTime(now);

    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "cbcn-1",
      provider: "codebuddy-cn",
      name: "cbcn-1",
      backoffLevel: 0,
    }]);

    // 1 hour later (exceeds MAX_RATE_LIMIT_COOLDOWN_MS of 30m)
    const resetAt = new Date("2026-10-16T11:00:00.000Z").getTime();

    try {
      const res = await markAccountUnavailable(
        "cbcn-1",
        429,
        "当前模型超出频率限制",
        "codebuddy-cn",
        "glm-5.3",
        resetAt,
      );

      expect(res.shouldFallback).toBe(true);
      expect(res.cooldownMs).toBe(60 * 60 * 1000); // 1 hour

      expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
        "cbcn-1",
        expect.objectContaining({
          "modelLock_glm-5.3": "2026-10-16T11:00:00.000Z",
          errorCode: 429,
          backoffLevel: 0,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors exact resetsAtMs for codex without truncating to 30m", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-16T10:00:00.000Z");
    vi.setSystemTime(now);

    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "codex-1",
      provider: "codex",
      name: "codex-1",
      backoffLevel: 0,
    }]);

    // 3 hours later (e.g. usage_limit_reached)
    const resetAt = new Date("2026-10-16T13:00:00.000Z").getTime();

    try {
      const res = await markAccountUnavailable(
        "codex-1",
        429,
        "usage_limit_reached",
        "codex",
        "gpt-5",
        resetAt,
      );

      expect(res.shouldFallback).toBe(true);
      expect(res.cooldownMs).toBe(3 * 60 * 60 * 1000); // 3 hours

      expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
        "codex-1",
        expect.objectContaining({
          "modelLock_gpt-5": "2026-10-16T13:00:00.000Z",
          errorCode: 429,
          backoffLevel: 0,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
