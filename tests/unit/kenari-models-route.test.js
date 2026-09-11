import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/kenari/models.json";

const mocks = vi.hoisted(() => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/models", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
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
const connection = { id: "kenari-connection", provider: "kenari", apiKey: "test-kenari-key" };
const request = new Request("http://localhost/api/providers/kenari-connection/models");
const context = { params: Promise.resolve({ id: connection.id }) };
let fetchMock;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProviderConnectionById.mockResolvedValue({ ...connection });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Kenari live models route", () => {
  it("preserves the complete fixture when live discovery succeeds", async () => {
    // Given
    fetchMock.mockResolvedValue(Response.json(fixture));
    // When
    const response = await GET(request, context);
    const body = await response.json();
    // Then
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://kenari.id/v1/models", {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}` },
    });
    expect(body).toEqual({ provider: connection.provider, connectionId: connection.id, models: fixture.data });
    const namelessModels = fixture.data.filter((model) => !Object.hasOwn(model, "name"));
    expect(namelessModels.length).toBeGreaterThan(0);
    expect(body.models.filter((model) => !Object.hasOwn(model, "name"))).toEqual(namelessModels);
    expect(body.models[0].id).toBe("agnes-2-0-flash:free");
    expect(body).not.toHaveProperty("source");
    expect(JSON.stringify(body)).not.toContain(connection.apiKey);
  });

  it("keeps four upstream models live rather than substituting seeds", async () => {
    // Given: these are upstream entries, not the four registry seeds.
    const models = fixture.data.slice(0, 4);
    fetchMock.mockResolvedValue(Response.json({ data: models }));
    // When
    const response = await GET(request, context);
    // Then
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      provider: connection.provider, connectionId: connection.id, models,
    });
  });

  it("returns 401 without fetching when the API key is missing", async () => {
    // Given
    mocks.getProviderConnectionById.mockResolvedValue({ id: connection.id, provider: connection.provider });
    // When
    const response = await GET(request, context);
    // Then
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "No valid token found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])("preserves upstream rejection status %s without a static fallback", async (status) => {
    // Given
    fetchMock.mockResolvedValue(new Response("upstream rejected request", { status }));
    // When
    const response = await GET(request, context);
    // Then
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: `Failed to fetch models: ${status}` });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the existing 500 response when the network fails", async () => {
    // Given
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    // When
    const response = await GET(request, context);
    // Then
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch models" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
