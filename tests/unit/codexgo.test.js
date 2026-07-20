import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

import {
  createProviderConnection,
  getProviderConnectionById,
  updateProviderConnection,
} from "@/models";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const NOW_MS = Date.parse("2026-07-02T00:00:00.000Z");
const ACCESS_EXP = Math.floor(Date.parse("2026-07-03T00:00:00.000Z") / 1000);

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function jwt(payload) {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

function codexGoResponse(overrides = {}) {
  const accessToken = jwt({
    exp: ACCESS_EXP,
    "https://api.openai.com/profile": {
      email: "codexgo@example.com",
    },
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-1",
      chatgpt_plan_type: "pro",
      chatgpt_user_id: "user-1",
    },
  });
  const idToken = jwt({
    email: "codexgo@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-1",
      chatgpt_plan_type: "pro",
    },
  });

  return {
    email: "codexgo@example.com",
    plan_type: "pro",
    account_id: "acct-1",
    user_id: "user-1",
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: "upstream-openai-refresh-token",
      account_id: "acct-1",
    },
    last_refresh: "2026-07-01T14:40:55.969Z",
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CodexGo credential helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("normalizes CodexGo access responses without persisting the upstream refresh token", async () => {
    const { normalizeCodexGoAccessResponse } = await import("../../open-sse/services/codexGo.js");

    const normalized = normalizeCodexGoAccessResponse(
      codexGoResponse(),
      "integration-secret",
      NOW_MS,
    );

    expect(normalized).toMatchObject({
      accessToken: expect.any(String),
      idToken: expect.any(String),
      refreshToken: "integration-secret",
      email: "codexgo@example.com",
      expiresAt: "2026-07-03T00:00:00.000Z",
      expiresIn: 86400,
      lastRefreshAt: "2026-07-01T14:40:55.969Z",
      providerSpecificData: {
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        chatgptPlanType: "pro",
        codexGoUserId: "user-1",
        codexGoAuthMode: "chatgpt",
      },
    });
    expect(normalized.refreshToken).not.toBe("upstream-openai-refresh-token");
    expect(normalized.providerSpecificData).not.toHaveProperty("integrationToken");
  });

  it("uses CodexGo /use for normal session sync", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));

    const { useCodexGoSession } = await import("../../open-sse/services/codexGo.js");
    const refreshed = await useCodexGoSession("integration-secret", null, { nowMs: NOW_MS });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/use");
    expect(proxyAwareFetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer integration-secret",
      },
    });
    expect(proxyAwareFetch.mock.calls[0][1].body).toBeUndefined();
    expect(refreshed.accessToken).toBeTruthy();
  });

  it("uses CodexGo /refresh with an empty JSON body only for manual session refresh", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));

    const { refreshCodexGoSession } = await import("../../open-sse/services/codexGo.js");
    await refreshCodexGoSession("integration-secret", null, { nowMs: NOW_MS });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/refresh");
    expect(proxyAwareFetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer integration-secret",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });

  it("dispatches CodexGo-backed Codex refreshes through /use", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const refreshed = await refreshTokenByProvider("codex", {
      refreshToken: "integration-secret",
      providerSpecificData: { authMethod: "codexgo" },
    }, null);

    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/use");
    expect(refreshed).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: "integration-secret",
      providerSpecificData: {
        authMethod: "codexgo",
      },
    });
  });

  it("keeps normal Codex OAuth refresh on OpenAI OAuth", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      access_token: "openai-access",
      refresh_token: "rotated-openai-refresh",
      expires_in: 3600,
    }));
    global.fetch = fetchMock;

    try {
      const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
      const refreshed = await refreshTokenByProvider("codex", {
        refreshToken: "normal-openai-refresh",
        providerSpecificData: { authMethod: "oauth" },
      }, null);

      expect(fetchMock.mock.calls[0][0]).toBe("https://auth.openai.com/oauth/token");
      expect(proxyAwareFetch).not.toHaveBeenCalled();
      expect(refreshed).toMatchObject({
        accessToken: "openai-access",
        refreshToken: "rotated-openai-refresh",
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("CodexGo Codex OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("imports a CodexGo integration token as a safe Codex OAuth connection", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));
    createProviderConnection.mockResolvedValueOnce({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Work CodexGo",
      email: "codexgo@example.com",
      providerSpecificData: {
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        chatgptPlanType: "pro",
      },
    });

    const { POST } = await import("../../src/app/api/oauth/codex/import-codexgo/route.js");
    const response = await POST(new Request("http://localhost/api/oauth/codex/import-codexgo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        integrationToken: "integration-secret",
        name: "Work CodexGo",
      }),
    }));
    const body = await response.json();

    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/use");
    expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      authType: "oauth",
      name: "Work CodexGo",
      email: "codexgo@example.com",
      refreshToken: "integration-secret",
      testStatus: "active",
      providerSpecificData: expect.objectContaining({
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        chatgptPlanType: "pro",
      }),
    }));
    expect(createProviderConnection.mock.calls[0][0].refreshToken).not.toBe("upstream-openai-refresh-token");
    expect(body.success).toBe(true);
    expect(body.connection).toMatchObject({
      id: "conn-1",
      provider: "codex",
      name: "Work CodexGo",
      email: "codexgo@example.com",
      workspace: "acct-1",
      plan: "pro",
      authMethod: "codexgo",
    });
    expect(JSON.stringify(body)).not.toContain("integration-secret");
    expect(JSON.stringify(body)).not.toContain("accessToken");
    expect(JSON.stringify(body)).not.toContain("idToken");
  });

  it("rejects CodexGo imports without an integration token", async () => {
    const { POST } = await import("../../src/app/api/oauth/codex/import-codexgo/route.js");
    const response = await POST(new Request("http://localhost/api/oauth/codex/import-codexgo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integrationToken: " " }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Integration token");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(createProviderConnection).not.toHaveBeenCalled();
  });

  it("manually refreshes only existing CodexGo-backed Codex connections", async () => {
    getProviderConnectionById.mockResolvedValueOnce({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Work CodexGo",
      email: "old@example.com",
      refreshToken: "integration-secret",
      providerSpecificData: {
        authMethod: "codexgo",
        chatgptAccountId: "old-acct",
      },
    });
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));
    updateProviderConnection.mockResolvedValueOnce({
      id: "conn-1",
      provider: "codex",
      name: "Work CodexGo",
      email: "codexgo@example.com",
      providerSpecificData: {
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        chatgptPlanType: "pro",
      },
    });

    const { POST } = await import("../../src/app/api/oauth/codex/codexgo-refresh/route.js");
    const response = await POST(new Request("http://localhost/api/oauth/codex/codexgo-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: "conn-1" }),
    }));
    const body = await response.json();

    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/refresh");
    expect(proxyAwareFetch.mock.calls[0][1].body).toBe("{}");
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      email: "codexgo@example.com",
      refreshToken: "integration-secret",
      testStatus: "active",
      providerSpecificData: expect.objectContaining({
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        chatgptPlanType: "pro",
        codexGoRefreshState: expect.objectContaining({
          lastRefreshAt: expect.any(String),
          lastRefreshReason: "manual",
          lastError: null,
          events: [expect.objectContaining({ reason: "manual" })],
        }),
      }),
    }));
    expect(updateProviderConnection.mock.calls[0][1].refreshToken).not.toBe("upstream-openai-refresh-token");
    expect(body.success).toBe(true);
    expect(body.connection).toMatchObject({
      id: "conn-1",
      provider: "codex",
      workspace: "acct-1",
      authMethod: "codexgo",
    });
    expect(JSON.stringify(body)).not.toContain("integration-secret");
  });

  it("allows manual refresh when hourly soft limit is exhausted", async () => {
    const recentRefreshAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    getProviderConnectionById.mockResolvedValueOnce({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      refreshToken: "integration-secret",
      providerSpecificData: {
        authMethod: "codexgo",
        codexGoRefreshConfig: { hourlyLimit: 1 },
        codexGoRefreshState: {
          events: [{ at: recentRefreshAt, reason: "manual" }],
        },
      },
    });
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(codexGoResponse()));
    updateProviderConnection.mockResolvedValueOnce({
      id: "conn-1",
      provider: "codex",
      email: "codexgo@example.com",
      providerSpecificData: {
        authMethod: "codexgo",
        chatgptAccountId: "acct-1",
        codexGoRefreshConfig: { hourlyLimit: 1, autoEnabled: false, thresholdRemainingPercent: 5 },
        codexGoRefreshState: {
          events: [
            { at: recentRefreshAt, reason: "manual" },
            { at: new Date().toISOString(), reason: "manual" },
          ],
          lastRefreshReason: "manual",
        },
      },
    });

    const { POST } = await import("../../src/app/api/oauth/codex/codexgo-refresh/route.js");
    const response = await POST(new Request("http://localhost/api/oauth/codex/codexgo-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: "conn-1" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(proxyAwareFetch.mock.calls[0][0]).toBe("https://codexgo.eu/api/codex-auth/refresh");
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      providerSpecificData: expect.objectContaining({
        codexGoRefreshState: expect.objectContaining({
          lastRefreshReason: "manual",
          events: [
            expect.objectContaining({ reason: "manual" }),
            expect.objectContaining({ reason: "manual" }),
          ],
        }),
      }),
    }));
    expect(body.connection.codexGoRefresh.window).toMatchObject({
      used: 2,
      limit: 1,
      exhausted: true,
    });
  });

  it("rejects manual refresh for non-CodexGo Codex connections", async () => {
    getProviderConnectionById.mockResolvedValueOnce({
      id: "conn-2",
      provider: "codex",
      authType: "oauth",
      refreshToken: "normal-openai-refresh",
      providerSpecificData: {},
    });

    const { POST } = await import("../../src/app/api/oauth/codex/codexgo-refresh/route.js");
    const response = await POST(new Request("http://localhost/api/oauth/codex/codexgo-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: "conn-2" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("CodexGo");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });
});
