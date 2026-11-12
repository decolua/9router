import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => Response.json(body, init) },
}));

const { POST } = await import("../../src/app/api/providers/validate/route.js");
const request = (apiKey = "fal-test-key", provider = "fal-ai") => new Request("http://localhost/api/providers/validate", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider, apiKey }),
});

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("Fal API-key validation (#993)", () => {
  it("checks a new key through the model catalog without submitting a generation", async () => {
    fetch.mockResolvedValueOnce(Response.json({ models: [] }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.fal.ai/v1/models?limit=1");
    expect(options.method || "GET").toBe("GET");
    expect(options.headers.Authorization).toBe("Key fal-test-key");
    expect(options.body).toBeUndefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403])("reports a rejected key on HTTP %s", async (status) => {
    fetch.mockResolvedValueOnce(new Response("", { status }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false, error: "Invalid API key" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])("does not accept or mislabel an inconclusive HTTP %s as a bad key", async (status) => {
    fetch.mockResolvedValueOnce(new Response("", { status }));
    const response = await POST(request());
    expect(await response.json()).toEqual({
      valid: false, error: `Unable to verify API key (Fal returned ${status})`,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a network error rather than reporting unsupported validation", async () => {
    fetch.mockRejectedValueOnce(new Error("network unavailable"));
    const response = await POST(request());
    expect(await response.json()).toEqual({ valid: false, error: "network unavailable" });
  });

  it("still requires a key before making any probe", async () => {
    const response = await POST(request(""));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provider and API key required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the same probe when the provider is supplied by its display name", async () => {
    fetch.mockResolvedValueOnce(Response.json({ models: [] }));
    const response = await POST(request("fal-test-key", "Fal.ai"));
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(fetch.mock.calls[0][0]).toBe("https://api.fal.ai/v1/models?limit=1");
  });
});
