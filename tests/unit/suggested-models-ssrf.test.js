import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

describe("/api/providers/suggested-models SSRF guard", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("allows known HTTPS model catalog hosts", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        data: [
          {
            id: "free/model",
            name: "Free Model",
            pricing: { prompt: "0", completion: "0" },
            context_length: 200000,
          },
        ],
      }),
    });

    const { GET } = await import("../../src/app/api/providers/suggested-models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/suggested-models?type=openrouter-free&url=https%3A%2F%2Fopenrouter.ai%2Fapi%2Fv1%2Fmodels"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toEqual([{ id: "free/model", name: "Free Model", contextLength: 200000 }]);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("blocks local targets without fetching them", async () => {
    const { GET } = await import("../../src/app/api/providers/suggested-models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/suggested-models?type=openrouter-free&url=http%3A%2F%2F127.0.0.1%3A11434%2Fapi%2Ftags"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.code).toBe("INVALID_SCHEME");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks unallowlisted HTTPS hosts", async () => {
    const { GET } = await import("../../src/app/api/providers/suggested-models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/suggested-models?type=openrouter-free&url=https%3A%2F%2Fexample.com%2Fmodels"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.code).toBe("HOST_NOT_ALLOWED");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
