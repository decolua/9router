// Tabitoken Check route (/api/provider-nodes/validate, openai-compatible path).
// Locks the Cloudflare behavior: tabitoken sits behind Cloudflare which HTML-403s
// Node/undici UA. The route must not confuse that with a bad API key — and the
// chat fallback must not either.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Keep dashboardGuard import-safe: no DB, no machine-id side effects.
vi.mock("@/lib/localDb", () => ({ getSettings: async () => null, validateApiKey: async () => false }));

const { POST } = await import("../../src/app/api/provider-nodes/validate/route.js");
const { openaiCompatFetchHeaders } = await import("open-sse/providers/shared.js");

const KEY = "sk-test";
const BASE = "https://tabitoken.com/v1";

const makeRes = (status, { ct = "application/json", body = "" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (name.toLowerCase() === "content-type" ? ct : null) },
  json: async () => JSON.parse(body || "{}"),
  text: async () => body,
});

const call = (body) =>
  POST(new Request("http://localhost:20127/api/provider-nodes/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: BASE, apiKey: KEY, type: "openai-compatible", ...body }),
  }));

describe("tabitoken Check route (Cloudflare vs API key)", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("models 200 → valid", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeRes(200, { body: '{"data":[]}' }));
    const res = await call({});
    expect((await res.json()).valid).toBe(true);
  });

  it("models 401 JSON → API key unauthorized (no chat attempt)", async () => {
    const f = vi.fn().mockResolvedValue(makeRes(401, { body: '{"error":"Invalid token"}' }));
    global.fetch = f;
    const res = await call({});
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).toBe("API key unauthorized");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("models 403 HTML → Cloudflare guidance, not 'API key unauthorized'", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeRes(403, { ct: "text/html; charset=UTF-8", body: "<!DOCTYPE html>Cloudflare" }));
    const res = await call({});
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).not.toBe("API key unauthorized");
    expect(data.error).toMatch(/Cloudflare|model ID/i);
  });

  it("models 403 HTML + modelId + chat 200 → valid via chat, Postman-like UA sent", async () => {
    const f = vi.fn().mockImplementation((url, opts = {}) => {
      if (String(url).endsWith("/models")) return Promise.resolve(makeRes(403, { ct: "text/html", body: "<html>" }));
      return Promise.resolve(makeRes(200, { body: '{"choices":[]}' }));
    });
    global.fetch = f;
    const res = await call({ modelId: "claude-opus-5-thinking" });
    expect((await res.json()).valid).toBe(true);
    const chatHeaders = f.mock.calls[1][1].headers;
    expect(chatHeaders["User-Agent"]).toMatch(/PostmanRuntime/);
    expect(chatHeaders.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("chat fallback 403 HTML → Cloudflare guidance, not 'API key unauthorized'", async () => {
    // RED first: route currently maps any chat 403 to "API key unauthorized",
    // so a Cloudflare HTML 403 on chat/completions gets mislabeled.
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).endsWith("/models")) return Promise.resolve(makeRes(403, { ct: "text/html", body: "<html>" }));
      return Promise.resolve(makeRes(403, { ct: "text/html; charset=UTF-8", body: "<!DOCTYPE html>Cloudflare" }));
    });
    const res = await call({ modelId: "claude-opus-5-thinking" });
    const data = await res.json();
    expect(data.valid).toBe(false);
    expect(data.error).not.toBe("API key unauthorized");
  });
});

describe("openaiCompatFetchHeaders", () => {
  it("sends Bearer + Postman-like UA + Accept", () => {
    const h = openaiCompatFetchHeaders(KEY);
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(h["User-Agent"]).toMatch(/PostmanRuntime/);
    expect(h.Accept).toBe("application/json");
    expect(h["Content-Type"]).toBeUndefined();
  });

  it("adds Content-Type when json:true", () => {
    expect(openaiCompatFetchHeaders(KEY, { json: true })["Content-Type"]).toBe("application/json");
  });
});
