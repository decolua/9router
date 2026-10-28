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

const QODER_QUOTA_BODY = '{"code":"112","message":"Quota exhausted","pricingUrl":"https://qoder.com/pricing"}';

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "qoder-a",
    provider: "qoder",
    name: "qoder-a",
    backoffLevel: 2,
  }]);
});

describe("Qoder quota exhaustion (403/code 112)", () => {
  it("disables the connection so the pool stops retrying a dead account", async () => {
    const result = await markAccountUnavailable(
      "qoder-a",
      403,
      QODER_QUOTA_BODY,
      "qoder",
      "qoder/ultimate",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "qoder-a",
      expect.objectContaining({
        isActive: false,
        testStatus: "unavailable",
        errorCode: 403,
        backoffLevel: 0,
      }),
    );
    // No timed model lock: the connection stays disabled until re-enabled.
    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(Object.keys(update).some(k => k.startsWith("modelLock_"))).toBe(false);
  });

  it("leaves transient billing blocks (queue throttle code 10605) on the normal cooldown path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T19:30:00.000Z"));

    try {
      await markAccountUnavailable(
        "qoder-a",
        403,
        '{"code":"10605","message":"Queue limit"}',
        "qoder",
        "qoder/ultimate",
      );

      const update = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(update.isActive).toBeUndefined();
      expect(update).toEqual(
        expect.objectContaining({
          "modelLock_qoder/ultimate": "2026-08-04T19:32:00.000Z",
          testStatus: "unavailable",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves plain qoder 403 errors without code 112 on the normal cooldown path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T19:30:00.000Z"));

    try {
      await markAccountUnavailable(
        "qoder-a",
        403,
        "Access denied",
        "qoder",
        "qoder/ultimate",
      );

      const update = dbMocks.updateProviderConnection.mock.calls[0][1];
      expect(update.isActive).toBeUndefined();
      expect(update).toEqual(
        expect.objectContaining({
          "modelLock_qoder/ultimate": "2026-08-04T19:32:00.000Z",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not disable non-qoder providers that happen to report code 112", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "other-a",
      provider: "other",
      name: "other-a",
      backoffLevel: 0,
    }]);

    await markAccountUnavailable(
      "other-a",
      403,
      '{"code":"112","message":"something else"}',
      "other",
      "some-model",
    );

    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(update.isActive).toBeUndefined();
  });
});
