import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const originalFetch = global.fetch;

describe("provider connection test - PR #1576 parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
    });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("opencode-go connection test", () => {
    it("tests opencode-go with POST to chat/completions endpoint", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-opencode-go",
        provider: "opencode-go",
        authType: "apikey",
        apiKey: "sk-test-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-opencode-go");

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "Authorization": "Bearer sk-test-key",
          }),
          body: expect.stringContaining("ping"),
        })
      );
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-opencode-go",
        expect.objectContaining({
          testStatus: "active",
          lastError: null,
        })
      );
    });

    it("detects invalid opencode-go API key (401)", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-opencode-go",
        provider: "opencode-go",
        authType: "apikey",
        apiKey: "sk-invalid-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-opencode-go");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-opencode-go",
        expect.objectContaining({
          testStatus: "error",
          lastError: expect.stringContaining("Invalid API key"),
        })
      );
    });

    it("detects access denied (403)", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-opencode-go",
        provider: "opencode-go",
        authType: "apikey",
        apiKey: "sk-forbidden-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-opencode-go");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });
  });

  describe("xiaomi-tokenplan connection test", () => {
    it("tests xiaomi-tokenplan with GET to /models endpoint", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-xiaomi-tokenplan",
        provider: "xiaomi-tokenplan",
        authType: "apikey",
        apiKey: "xiaomi-test-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "model-1" }, { id: "model-2" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-xiaomi-tokenplan");

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        "https://token-plan-sgp.xiaomimimo.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Authorization": "Bearer xiaomi-test-key",
          }),
        })
      );
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-xiaomi-tokenplan",
        expect.objectContaining({
          testStatus: "active",
          lastError: null,
        })
      );
    });

    it("detects invalid xiaomi-tokenplan API key", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-xiaomi-tokenplan",
        provider: "xiaomi-tokenplan",
        authType: "apikey",
        apiKey: "xiaomi-invalid-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-xiaomi-tokenplan");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
      expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
        "conn-xiaomi-tokenplan",
        expect.objectContaining({
          testStatus: "error",
          lastError: expect.stringContaining("Invalid API key"),
        })
      );
    });
  });

  describe("xiaomi-mimo connection test", () => {
    it("tests xiaomi-mimo with GET to /models endpoint using correct base URL", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue({
        id: "conn-xiaomi-mimo",
        provider: "xiaomi-mimo",
        authType: "apikey",
        apiKey: "mimo-test-key",
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "mimo-model-1" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await testSingleConnection("conn-xiaomi-mimo");

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.xiaomimimo.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Authorization": "Bearer mimo-test-key",
          }),
        })
      );
    });
  });

  describe("connection not found", () => {
    it("returns error when connection does not exist", async () => {
      const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");

      mocks.getProviderConnectionById.mockResolvedValue(null);

      const result = await testSingleConnection("non-existent-id");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Connection not found");
    });
  });
});
