import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/provider-nodes/validate/route.js";

function validationRequest(baseUrl, headers = {}) {
  return new Request("http://router.example/api/provider-nodes/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "router.example",
      ...headers,
    },
    body: JSON.stringify({
      baseUrl,
      apiKey: "test-key",
      type: "openai",
    }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider node validation SSRF boundary (#3293)", () => {
  it("returns 400 for the reported IPv4-mapped IPv6 bypass", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(validationRequest("http://[::ffff:7f00:1]:19998"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "URL not allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a public provider URL working through the guarded dispatcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(validationRequest("https://api.example.com/v1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({ dispatcher: expect.any(Object) }),
    );
  });

  it("preserves private self-hosted validation for a trusted local peer", async () => {
    vi.stubEnv("NINEROUTER_PEER_TOKEN", "server-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(validationRequest("http://127.0.0.1:11434/v1", {
      Host: "localhost:20127",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "server-secret",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/models",
      { headers: { Authorization: "Bearer test-key" } },
    );
  });
});
