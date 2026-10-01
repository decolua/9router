import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));

const { POST } = await import("../../src/app/api/providers/validate/route.js");

describe("Azure Responses connection validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("identifies deployment and configuration as possible causes of a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        apiKey: "test-key",
        providerSpecificData: {
          azureEndpoint: "https://example-resource.openai.azure.com",
          deployment: "missing-deployment",
          apiType: "responses",
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example-resource.openai.azure.com/openai/v1/responses?api-version=preview",
      expect.objectContaining({ method: "POST" }),
    );
    expect(body.valid).toBe(false);
    expect(body.error).toMatch(/deployment/i);
    expect(body.error).toMatch(/configuration/i);
  });
});
