import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function mockConn(overrides = {}) {
  return {
    id: "conn-web-1",
    provider: "chatgpt-web",
    authType: "cookie",
    apiKey: "__Secure-next-auth.session-token=valid-token",
    isActive: true,
    testStatus: "active",
    lastError: null,
    providerSpecificData: {},
    ...overrides,
  };
}

describe("Background Session Cookie Manager (Issue #3355)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  describe("selectWebConnectionsNeedingCheck", () => {
    it("selects active web cookie provider connections", async () => {
      const { selectWebConnectionsNeedingCheck } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const connections = [
        mockConn({ id: "c1", provider: "chatgpt-web" }),
        mockConn({ id: "c2", provider: "openai", authType: "apikey" }),
        mockConn({ id: "c3", provider: "deepseek-web", authType: "cookie" }),
        mockConn({ id: "c4", provider: "grok-web", isActive: false }),
      ];

      const selected = selectWebConnectionsNeedingCheck(connections, NOW);
      expect(selected.map((c) => c.id)).toEqual(["c1", "c3"]);
    });

    it("skips web connections tested recently unless near expiry", async () => {
      const { selectWebConnectionsNeedingCheck } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const recentCheckTime = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5 min atrás
      const oldCheckTime = new Date(NOW - 35 * 60 * 1000).toISOString(); // 35 min atrás

      const connections = [
        mockConn({
          id: "c-recent",
          providerSpecificData: { lastWebCheckAt: recentCheckTime },
        }),
        mockConn({
          id: "c-old",
          providerSpecificData: { lastWebCheckAt: oldCheckTime },
        }),
        mockConn({
          id: "c-expiring-soon",
          expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
          providerSpecificData: { lastWebCheckAt: recentCheckTime },
        }),
      ];

      const selected = selectWebConnectionsNeedingCheck(connections, NOW);
      expect(selected.map((c) => c.id)).toEqual(["c-old", "c-expiring-soon"]);
    });

    it("supports connections marked with authMethod === 'web-login'", async () => {
      const { selectWebConnectionsNeedingCheck } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const connections = [
        mockConn({
          id: "c-weblogin",
          provider: "custom-web-service",
          authType: "apikey",
          providerSpecificData: { authMethod: "web-login" },
        }),
      ];

      const selected = selectWebConnectionsNeedingCheck(connections, NOW);
      expect(selected.map((c) => c.id)).toEqual(["c-weblogin"]);
    });
  });

  describe("validateAndRefreshWebConnection", () => {
    it("updates status to active and records check timestamp on valid probe", async () => {
      const { validateAndRefreshWebConnection } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const updateFn = vi.fn().mockResolvedValue({ id: "c1" });
      const probeFn = vi.fn().mockResolvedValue({
        ok: true,
        status: "valid",
        email: "user@example.com",
      });

      const connection = mockConn({ id: "c1", testStatus: "unknown" });
      const result = await validateAndRefreshWebConnection(connection, {
        probe: probeFn,
        updateConnection: updateFn,
      });

      expect(result.valid).toBe(true);
      expect(updateFn).toHaveBeenCalledWith("c1", expect.objectContaining({
        testStatus: "active",
        lastError: null,
        providerSpecificData: expect.objectContaining({
          lastWebCheckAt: expect.any(String),
        }),
      }));
    });

    it("marks connection unavailable when probe detects expired session", async () => {
      const { validateAndRefreshWebConnection } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const updateFn = vi.fn().mockResolvedValue({ id: "c1" });
      const probeFn = vi.fn().mockResolvedValue({
        ok: false,
        status: "invalid",
        error: "Session cookie is invalid or expired",
      });

      const connection = mockConn({ id: "c1", testStatus: "active" });
      const result = await validateAndRefreshWebConnection(connection, {
        probe: probeFn,
        updateConnection: updateFn,
      });

      expect(result.valid).toBe(false);
      expect(updateFn).toHaveBeenCalledWith("c1", expect.objectContaining({
        testStatus: "unavailable",
        lastError: "Session cookie is invalid or expired",
        lastErrorAt: expect.any(String),
        providerSpecificData: expect.objectContaining({
          lastWebCheckAt: expect.any(String),
        }),
      }));
    });

    it("preserves status when probe returns unknown due to transient network failure", async () => {
      const { validateAndRefreshWebConnection } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const updateFn = vi.fn().mockResolvedValue({ id: "c1" });
      const probeFn = vi.fn().mockResolvedValue({
        ok: false,
        status: "unknown",
        error: "fetch failed / timeout",
      });

      const connection = mockConn({ id: "c1", testStatus: "active" });
      const result = await validateAndRefreshWebConnection(connection, {
        probe: probeFn,
        updateConnection: updateFn,
      });

      expect(result.valid).toBe(true);
      expect(result.inconclusive).toBe(true);
      // Fail-open: should NOT mark as unavailable
      expect(updateFn).toHaveBeenCalledWith("c1", expect.objectContaining({
        providerSpecificData: expect.objectContaining({
          lastWebCheckAt: expect.any(String),
        }),
      }));
      expect(updateFn).not.toHaveBeenCalledWith("c1", expect.objectContaining({
        testStatus: "unavailable",
      }));
    });
  });

  describe("runBackgroundCookieManagerTick", () => {
    it("iterates over due connections sequentially without crashing on single error", async () => {
      const { runBackgroundCookieManagerTick } = await import(
        "../../src/sse/services/backgroundCookieManager.js"
      );

      const connections = [
        mockConn({ id: "c1" }),
        mockConn({ id: "c2" }),
      ];

      const loadConnections = vi.fn().mockResolvedValue(connections);
      const validateFn = vi.fn()
        .mockRejectedValueOnce(new Error("Transient probe explosion"))
        .mockResolvedValueOnce({ valid: true });
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      await runBackgroundCookieManagerTick({
        loadConnections,
        validateConnection: validateFn,
        sleep: sleepFn,
      });

      expect(loadConnections).toHaveBeenCalled();
      expect(validateFn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1); // Sleep between c1 and c2
    });
  });

  describe("Lifecycle controls", () => {
    it("starts and stops timer cleanly", async () => {
      const {
        startBackgroundCookieManager,
        stopBackgroundCookieManager,
      } = await import("../../src/sse/services/backgroundCookieManager.js");

      expect(startBackgroundCookieManager({ intervalMs: 60000 })).toBe(true);
      // Double call should be no-op
      expect(startBackgroundCookieManager({ intervalMs: 60000 })).toBe(false);

      stopBackgroundCookieManager();
      // Can be started again after stop
      expect(startBackgroundCookieManager({ intervalMs: 60000 })).toBe(true);
      stopBackgroundCookieManager();
    });
  });

  describe("API route /api/providers/web-session/check", () => {
    it("handles on-demand probe request for a specific connection", async () => {
      vi.doMock("@/models", () => ({
        getProviderConnectionById: vi.fn().mockResolvedValue(mockConn({ id: "conn-1" })),
        getProviderConnections: vi.fn().mockResolvedValue([]),
        updateProviderConnection: vi.fn().mockResolvedValue({ id: "conn-1" }),
      }));
      vi.doMock("open-sse/services/webIdentity.js", () => ({
        fetchWebIdentity: vi.fn().mockResolvedValue({ ok: true, status: "valid", email: "user@example.com" }),
      }));

      const { POST } = await import("../../src/app/api/providers/web-session/check/route.js");
      const fakeReq = {
        json: async () => ({ connectionId: "conn-1" }),
      };

      const res = await POST(fakeReq);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        connectionId: "conn-1",
        valid: true,
        error: null,
        inconclusive: false,
      });
    });
  });
});
