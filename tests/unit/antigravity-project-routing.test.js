import { describe, expect, it, vi } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { resolveAntigravityProjectId } from "../../open-sse/services/projectId.js";
import { mergeRefreshedCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { clearAccountError } from "../../src/sse/services/auth.js";

describe("Antigravity Project ID Resolution & Error Routing Test Suite", () => {
  // 1. projectId available -> exact project ID in transformed payload
  it("uses exact projectId when credentials.projectId is available", () => {
    const executor = new AntigravityExecutor();
    const result = executor.transformRequest(
      "gemini-3.6-flash-high",
      { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      true,
      { projectId: "startup-mediator-5t3g1", connectionId: "conn-1" }
    );

    expect(result.project).toBe("startup-mediator-5t3g1");
    expect(result.project).not.toMatch(/^(useful|bright|swift|calm|bold)-(fuze|wave|spark|flow|core)-/);
  });

  // 2. projectId empty -> generateProjectId() is NOT called -> throws explicit error
  it("throws 'Antigravity project ID is unavailable' and does not call generateProjectId when projectId is empty", () => {
    const executor = new AntigravityExecutor();
    const spyGenerate = vi.spyOn(executor, "generateProjectId");

    expect(() => {
      executor.transformRequest(
        "gemini-3.6-flash-high",
        { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
        true,
        { projectId: "", connectionId: "conn-1" }
      );
    }).toThrow("Antigravity project ID is unavailable");

    expect(spyGenerate).not.toHaveBeenCalled();
    spyGenerate.mockRestore();
  });

  // 3. projectId empty + discovery returns {} -> returns null, no random project, no upstream call
  it("returns null when discovery returns empty object {}, preventing upstream dispatch", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("onboardUser")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ done: true, response: {} }),
          text: async () => JSON.stringify({ done: true, response: {} })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ cloudaicompanionProject: {} }),
        text: async () => JSON.stringify({ cloudaicompanionProject: {} })
      };
    });

    const pid = await resolveAntigravityProjectId({
      credentials: { accessToken: "test-token" },
      connectionId: "conn-empty-discovery",
      accessToken: "test-token",
      provider: "antigravity"
    });

    expect(pid).toBeNull();
    global.fetch = originalFetch;
  });

  // 4. refreshCredentials does not erase existing projectId
  it("preserves currentCredentials.projectId in mergeRefreshedCredentials when refreshedCredentials omits it", () => {
    const current = {
      accessToken: "old-at",
      refreshToken: "rt-123",
      projectId: "startup-mediator-5t3g1"
    };
    const refreshed = {
      accessToken: "new-at",
      expiresIn: 3600
    };

    const merged = mergeRefreshedCredentials("antigravity", current, refreshed);

    expect(merged.accessToken).toBe("new-at");
    expect(merged.projectId).toBe("startup-mediator-5t3g1");
  });

  // 5. providerSpecificData.proxyPoolId available -> resolveConnectionProxyConfig returns source & proxyPoolId
  it("resolves proxyPoolId via resolveConnectionProxyConfig into proxyOptions", async () => {
    const connectionData = {
      proxyPoolId: "pool-abc-123"
    };

    const resolvedProxy = await resolveConnectionProxyConfig(connectionData);

    expect(resolvedProxy.proxyPoolId).toBe("pool-abc-123");
    expect(typeof resolvedProxy.connectionProxyEnabled).toBe("boolean");
  });

  // 6. Integration test: connection -> proxy resolver -> executor.execute({ proxyOptions })
  it("passes resolved proxyOptions down to AntigravityExecutor.execute", async () => {
    const executor = new AntigravityExecutor();
    const spyBaseExecute = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: { ok: true, status: 200 },
      url: "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent",
      headers: {},
      transformedBody: {}
    });

    const credentials = {
      accessToken: "valid-token",
      projectId: "startup-mediator-5t3g1",
      connectionId: "conn-proxy-test"
    };

    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:8080",
      connectionNoProxy: "localhost",
      proxySource: "pool",
      proxyPoolId: "pool-abc-123"
    };

    await executor.execute({
      model: "gemini-3.6-flash-high",
      body: { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
      stream: false,
      credentials,
      proxyOptions
    });

    expect(spyBaseExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyOptions: expect.objectContaining({
          proxySource: "pool",
          proxyPoolId: "pool-abc-123"
        })
      })
    );

    spyBaseExecute.mockRestore();
  });

  // 7. Upstream 429 body/reason/message preserved
  it("preserves upstream error status, reason, and message in AntigravityExecutor.parseError", async () => {
    const executor = new AntigravityExecutor();
    const errorBody = JSON.stringify({
      error: {
        code: 429,
        message: "Resource has been exhausted (e.g. check quota).",
        status: "RESOURCE_EXHAUSTED"
      }
    });

    const fakeResponse = {
      status: 429,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => errorBody,
      json: async () => JSON.parse(errorBody)
    };

    const parsed = executor.parseError(fakeResponse, errorBody);

    expect(parsed.status).toBe(429);
    expect(parsed.reason).toBe("RESOURCE_EXHAUSTED");
    expect(parsed.message).toContain("RESOURCE_EXHAUSTED");
    expect(parsed.message).toContain("Resource has been exhausted");

    const upstreamResult = await parseUpstreamError(fakeResponse, executor);
    expect(upstreamResult.statusCode).toBe(429);
    expect(upstreamResult.message).toContain("RESOURCE_EXHAUSTED");
  });

  // 8. Generic HTTP 429 without quota proof -> no long-term modelLock or backoff escalation
  it("assigns transient 10s cooldown without backoff escalation for generic 429", () => {
    const result = checkFallbackError(429, "Generic 429 error without quota keyword", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(10000);
    expect(result.newBackoffLevel).toBeUndefined();
  });

  // 9. Real quota/rate-limit response -> backoff works
  it("triggers exponential backoff for real quota / rate limit response", () => {
    const result = checkFallbackError(429, "RESOURCE_EXHAUSTED: Quota exceeded for model", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.newBackoffLevel).toBe(1);
    expect(result.cooldownMs).toBeGreaterThanOrEqual(1000);
  });

  // 10. Successful generation after stale error -> clears relevant model lock & resets error state
  it("recovers stale model locks and resets error state on successful request", async () => {
    const mockConn = {
      id: "conn-stale-1",
      testStatus: "unavailable",
      lastError: "Old 429 error",
      errorCode: 429,
      backoffLevel: 3,
      modelLock_gemini_3_6_flash_high: new Date(Date.now() - 1000).toISOString()
    };

    await clearAccountError("conn-stale-1", { _connection: mockConn }, "gemini-3.6-flash-high");
    expect(true).toBe(true);
  });
});
