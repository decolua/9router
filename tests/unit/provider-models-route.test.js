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

  it("returns the registered static catalog for an active GLM connection without credentials", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "glm-connection",
      provider: "glm",
      apiKey: "test-api-key",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      providerSpecificData: { baseUrl: "https://provider.example", headers: { Authorization: "Bearer test-api-key" } },
    });

    const response = await GET(
      new Request("http://localhost/api/providers/glm-connection/models"),
      { params: Promise.resolve({ id: "glm-connection" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      provider: "glm",
      connectionId: "glm-connection",
      source: "local_catalog",
    });
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
    ]));
    expect(JSON.stringify(body)).not.toMatch(/apiKey|accessToken|refreshToken|providerSpecificData|baseUrl|headers|test-api-key|test-access-token|test-refresh-token/i);
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
