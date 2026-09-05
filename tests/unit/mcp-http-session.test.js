// MCP-02: HTTP session isolation and retry hardening.
// Tests that session state is instance-safe (not shared on instance.__mcpInit),
// that concurrent ensureInitialized calls single-flight, and that transient
// errors trigger bounded retry.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock fetch globally before importing httpClient.
global.fetch = vi.fn();

const httpModule = await import("../../src/lib/mcp/gateway/httpClient");
const { ensureInitialized, mcpRequest, listTools, __test__ } = httpModule;
const { getSessionStore, clearSessionEntry } = __test__;

function makeInstance(id = "http-1", slug = "test-http") {
  return {
    id,
    slug,
    url: "http://fake-mcp.local/mcp",
    oauth: false,
    headers: {},
  };
}

function mockFetchResponse(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => headers[k.toLowerCase()] || null,
    },
    text: async () => text,
  };
}

beforeEach(() => {
  getSessionStore().clear();
  global.fetch.mockClear();
  vi.clearAllTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpClient — MCP-02 session isolation", () => {
  it("session state is stored in global map, not instance.__mcpInit", async () => {
    const instance = makeInstance();
    global.fetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: 0,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fake" },
        },
      }, { "mcp-session-id": "sess-abc" })
    );
    // Mock notifications/initialized response.
    global.fetch.mockResolvedValueOnce(mockFetchResponse(200, { jsonrpc: "2.0" }));

    const info = await ensureInitialized(instance);
    expect(info.sessionId).toBe("sess-abc");
    expect(instance.__mcpInit).toBeUndefined();

    const store = getSessionStore();
    const entry = store.get(instance.id);
    expect(entry).toBeDefined();
    expect(entry.sessionId).toBe("sess-abc");
    expect(entry.protocolVersion).toBe("2025-06-18");
  });

  it("concurrent ensureInitialized calls single-flight (one initialize frame)", async () => {
    const instance = makeInstance();
    global.fetch.mockImplementation(async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === "initialize") {
        // Delay to ensure both calls are pending.
        await new Promise((r) => setTimeout(r, 10));
        return mockFetchResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
        }, { "mcp-session-id": "sess-xyz" });
      }
      return mockFetchResponse(200, { jsonrpc: "2.0" });
    });

    const [r1, r2] = await Promise.all([
      ensureInitialized(instance),
      ensureInitialized(instance),
    ]);
    expect(r1).toEqual(r2);
    expect(r1.sessionId).toBe("sess-xyz");

    // Only one initialize frame should have been sent (plus two notifications/initialized).
    const initCalls = global.fetch.mock.calls.filter((call) => {
      const body = JSON.parse(call[1].body);
      return body.method === "initialize";
    });
    expect(initCalls.length).toBe(1);
  });

  it("failed initialize clears session entry so next call retries", async () => {
    const instance = makeInstance();
    global.fetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: 0,
        error: { code: -32602, message: "unsupported protocol" },
      })
    );

    await expect(ensureInitialized(instance)).rejects.toThrow(/initialize failed/);
    expect(getSessionStore().has(instance.id)).toBe(false);
  });

  it("subsequent calls reuse cached session without re-initializing", async () => {
    const instance = makeInstance();
    global.fetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: 0,
        result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
      }, { "mcp-session-id": "sess-cached" })
    );
    global.fetch.mockResolvedValueOnce(mockFetchResponse(200, { jsonrpc: "2.0" }));

    const info1 = await ensureInitialized(instance);
    const info2 = await ensureInitialized(instance);
    expect(info1).toEqual(info2);
    expect(info1.sessionId).toBe("sess-cached");

    // Only one initialize call (first ensureInitialized).
    const initCalls = global.fetch.mock.calls.filter((call) => {
      const body = JSON.parse(call[1].body);
      return body.method === "initialize";
    });
    expect(initCalls.length).toBe(1);
  });
});

describe("httpClient — MCP-02 transient retry", () => {
  it("retries on transient network error (ECONNREFUSED)", async () => {
    const instance = makeInstance();
    let calls = 0;
    global.fetch.mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        const err = new Error("fetch failed");
        err.code = "ECONNREFUSED";
        throw err;
      }
      return mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [] },
      });
    });

    const result = await mcpRequest(instance, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }, { maxAttempts: 2, baseDelayMs: 10 });
    expect(result.result).toEqual({ tools: [] });
    expect(calls).toBe(2); // Initial + 1 retry.
  });

  it("does not retry on McpAuthError (401)", async () => {
    const instance = makeInstance();
    global.fetch.mockResolvedValueOnce(mockFetchResponse(401, "Unauthorized"));

    const promise = mcpRequest(instance, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    await expect(promise).rejects.toThrow(/upstream 401/);
    expect(global.fetch).toHaveBeenCalledTimes(1); // No retry.
  });

  it("retries on 503 (transient server error)", async () => {
    const instance = makeInstance();
    let calls = 0;
    global.fetch.mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        return mockFetchResponse(503, "Service Unavailable");
      }
      return mockFetchResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [] },
      });
    });

    const result = await mcpRequest(instance, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(result.result).toEqual({ tools: [] });
    expect(calls).toBe(2);
  });

  it("skipRetry option disables retry", async () => {
    const instance = makeInstance();
    const err = new Error("timeout");
    err.code = "ETIMEDOUT";
    global.fetch.mockRejectedValueOnce(err);

    const promise = mcpRequest(
      instance,
      { jsonrpc: "2.0", id: 1, method: "test", params: {} },
      { skipRetry: true }
    );
    await expect(promise).rejects.toThrow("timeout");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("httpClient — listTools integration", () => {
  it("initializes then fetches tools with retry on transient failure", async () => {
    const instance = makeInstance();
    let fetchCount = 0;
    global.fetch.mockImplementation(async (url, opts) => {
      fetchCount++;
      const body = JSON.parse(opts.body);
      if (body.method === "initialize") {
        return mockFetchResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } },
        }, { "mcp-session-id": "sess-tools" });
      }
      if (body.method === "notifications/initialized") {
        return mockFetchResponse(200, { jsonrpc: "2.0" });
      }
      if (body.method === "tools/list") {
        // Fail first attempt, succeed on retry.
        if (fetchCount === 3) {
          const err = new Error("timeout");
          throw err;
        }
        return mockFetchResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "echo" }] },
        });
      }
      return mockFetchResponse(200, { jsonrpc: "2.0" });
    });

    const tools = await listTools(instance);
    expect(tools).toEqual([{ name: "echo" }]);
    // initialize, notifications/initialized, tools/list (fail), tools/list (success).
    expect(fetchCount).toBeGreaterThanOrEqual(4);
  });
});
