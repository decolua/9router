import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function mockNextResponse() {
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
}

describe("compatible client identity route headers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockNextResponse();
    vi.doMock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.doUnmock("next/server");
    vi.doUnmock("@/dashboardGuard");
    vi.resetModules();
  });

  it("provider node validation sends identity headers for OpenAI compatible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock;
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");

    const response = await POST(new Request("https://9router.local/api/provider-nodes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "real-key",
        type: "openai-compatible",
        clientIdentityProfile: "openclaw",
      }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "User-Agent": "openclaw/2026.2.3",
        }),
      }),
    );
  });

  it("provider node validation sends identity headers for Anthropic compatible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock;
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");

    await POST(new Request("https://9router.local/api/provider-nodes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "real-key",
        type: "anthropic-compatible",
        clientIdentityProfile: "claude-cli",
      }),
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "x-api-key": "real-key",
          "X-App": "cli",
          "Anthropic-Beta": expect.stringContaining("claude-code-20250219"),
        }),
      }),
    );
  });

  it("/v1/models compatible discovery sends identity headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "glm-5.2" }] }),
    });
    globalThis.fetch = fetchMock;
    const { fetchCompatibleModelIds } = await import("@/app/api/v1/models/route.js");

    const models = await fetchCompatibleModelIds({
      provider: "openai-compatible-chat-node",
      apiKey: "real-key",
      providerSpecificData: {
        baseUrl: "https://gateway.example.com/v1",
        clientIdentityProfile: "openclaw",
      },
    });

    expect(models).toEqual(["glm-5.2"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "User-Agent": "openclaw/2026.2.3",
        }),
      }),
    );
  });

  it("/api/providers/validate sends identity headers for OpenAI compatible saved node validation", async () => {
    vi.doMock("@/models", () => ({
      getProviderNodeById: vi.fn().mockResolvedValue({
        id: "openai-compatible-chat-node",
        type: "openai-compatible",
        baseUrl: "https://gateway.example.com/v1",
        clientIdentityProfile: "openclaw",
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock;
    const { POST } = await import("@/app/api/providers/validate/route.js");

    const response = await POST(new Request("https://9router.local/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai-compatible-chat-node",
        apiKey: "real-key",
        providerSpecificData: {
          clientIdentityProfile: "openclaw",
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "User-Agent": "openclaw/2026.2.3",
        }),
      }),
    );
  });

  it("/api/providers/validate sends identity headers and body defaultModel for Anthropic compatible", async () => {
    vi.doMock("@/models", () => ({
      getProviderNodeById: vi.fn().mockResolvedValue({
        id: "anthropic-compatible-node",
        type: "anthropic-compatible",
        baseUrl: "https://gateway.example.com/v1/messages",
        defaultModel: "node-model",
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad request" }),
      text: async () => "bad request",
    });
    globalThis.fetch = fetchMock;
    const { POST } = await import("@/app/api/providers/validate/route.js");

    const response = await POST(new Request("https://9router.local/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic-compatible-node",
        apiKey: "real-key",
        defaultModel: "body-model",
        providerSpecificData: {
          clientIdentityProfile: "claude-cli",
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "x-api-key": "real-key",
          "X-App": "cli",
          "Anthropic-Beta": expect.stringContaining("claude-code-20250219"),
        }),
        body: expect.any(String),
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe("body-model");
  });

  it("/api/providers/[id]/models uses saved OpenAI compatible connection identity", async () => {
    vi.doMock("@/models", () => ({
      getProviderConnectionById: vi.fn().mockResolvedValue({
        id: "conn-1",
        provider: "openai-compatible-chat-node",
        apiKey: "real-key",
        providerSpecificData: {
          baseUrl: "https://gateway.example.com/v1",
          clientIdentityProfile: "openclaw",
        },
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "model-a" }] }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock;
    const { GET } = await import("@/app/api/providers/[id]/models/route.js");

    const response = await GET(new Request("https://9router.local/api/providers/conn-1/models"), {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "User-Agent": "openclaw/2026.2.3",
        }),
      }),
    );
  });

  it("/api/providers/[id]/models uses saved Anthropic compatible connection identity", async () => {
    vi.doMock("@/models", () => ({
      getProviderConnectionById: vi.fn().mockResolvedValue({
        id: "conn-1",
        provider: "anthropic-compatible-node",
        apiKey: "real-key",
        providerSpecificData: {
          baseUrl: "https://gateway.example.com/v1/messages",
          clientIdentityProfile: "claude-cli",
        },
      }),
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "claude-like" }] }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock;
    const { GET } = await import("@/app/api/providers/[id]/models/route.js");

    const response = await GET(new Request("https://9router.local/api/providers/conn-1/models"), {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer real-key",
          "x-api-key": "real-key",
          "X-App": "cli",
          "Anthropic-Beta": expect.stringContaining("claude-code-20250219"),
        }),
      }),
    );
  });
});
