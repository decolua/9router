import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

describe("provider models route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["glm", "minimax"])("returns the registered static catalog for an active %s connection without credentials", async (provider) => {
    const connectionId = `${provider}-connection`;
    mocks.getProviderConnectionById.mockResolvedValue({
      id: connectionId,
      provider,
      apiKey: "test-api-key",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      providerSpecificData: { baseUrl: "https://provider.example", headers: { Authorization: "Bearer test-api-key" } },
    });

    const response = await GET(
      new Request(`http://localhost/api/providers/${connectionId}/models`),
      { params: Promise.resolve({ id: connectionId }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider,
      connectionId,
      source: "local_catalog",
    });
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
    ]));
    expect(JSON.stringify(body)).not.toMatch(/apiKey|accessToken|refreshToken|providerSpecificData|baseUrl|headers|test-api-key|test-access-token|test-refresh-token/i);
  });

  it("keeps configured providers on their live discovery path", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "claude-connection",
      provider: "claude",
      apiKey: "live-discovery-key",
    });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "live-model" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/providers/claude-connection/models"),
      { params: Promise.resolve({ id: "claude-connection" }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      provider: "claude",
      connectionId: "claude-connection",
      models: [{ id: "live-model" }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("returns live Antigravity models from the production discovery contract", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "antigravity-connection",
      provider: "antigravity",
      accessToken: "test-access-token",
      projectId: "test-project",
    });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      models: { "live-model": { displayName: "Live Model" } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/providers/antigravity-connection/models"),
      { params: Promise.resolve({ id: "antigravity-connection" }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      provider: "antigravity",
      connectionId: "antigravity-connection",
      models: [{ id: "live-model", name: "Live Model" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
          "X-Client-Name": "antigravity",
        }),
        body: JSON.stringify({ project: "test-project" }),
      })
    );
    vi.unstubAllGlobals();
  });

  it("returns the static Antigravity catalog when live discovery responds with 404", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "antigravity-connection",
      provider: "antigravity",
      accessToken: "test-access-token",
      projectId: "test-project",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("obsolete endpoint", { status: 404 })));

    const response = await GET(
      new Request("http://localhost/api/providers/antigravity-connection/models"),
      { params: Promise.resolve({ id: "antigravity-connection" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "antigravity",
      connectionId: "antigravity-connection",
      warning: expect.any(String),
    });
    expect(body.models.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/test-access-token|obsolete endpoint|https?:\/\//i);
    vi.unstubAllGlobals();
  });

  it("returns the static Antigravity catalog when live discovery is empty", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "antigravity-empty-connection",
      provider: "antigravity",
      accessToken: "test-access-token",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ models: {} })));

    const response = await GET(
      new Request("http://localhost/api/providers/antigravity-empty-connection/models"),
      { params: Promise.resolve({ id: "antigravity-empty-connection" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.warning).toBe("Antigravity live model discovery is unavailable; using the static catalog.");
    vi.unstubAllGlobals();
  });

  it("keeps a missing connection as a local 404", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/providers/missing-antigravity/models"),
      { params: Promise.resolve({ id: "missing-antigravity" }) }
    );

    await expect(response.json()).resolves.toEqual({ error: "Connection not found" });
    expect(response.status).toBe(404);
  });

  it("keeps unsupported providers on the existing models-listing error", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "unsupported-connection",
      provider: "unsupported-provider",
    });

    const response = await GET(
      new Request("http://localhost/api/providers/unsupported-connection/models"),
      { params: Promise.resolve({ id: "unsupported-connection" }) }
    );

    await expect(response.json()).resolves.toEqual({
      error: "Provider unsupported-provider does not support models listing",
    });
    expect(response.status).toBe(400);
  });
});
