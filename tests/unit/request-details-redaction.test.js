import { describe, it, expect } from "vitest";

// Mirror the list-shaping logic from src/app/api/usage/request-details/route.js
// so we can test it in isolation.
const PAYLOAD_KEYS = ["request", "providerRequest", "providerResponse", "response"];

function stripPayloads(detail) {
  const meta = { ...(detail || {}) };
  let bytes = 0;
  for (const key of PAYLOAD_KEYS) {
    const value = meta[key];
    delete meta[key];
    if (value === undefined || value === null) continue;
    try {
      bytes += JSON.stringify(value).length;
    } catch {
      continue;
    }
  }
  meta.hasDetail = true;
  meta.payloadBytes = bytes;
  return meta;
}

function stripDetails(details) {
  return (details || []).map(stripPayloads);
}

describe("request-details list shaping", () => {
  it("strips conversation payloads but keeps metadata", () => {
    const details = [{
      id: "abc",
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      timestamp: "2026-08-05T00:00:00Z",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { messages: [{ role: "user", content: "secret prompt" }] },
      providerRequest: { messages: [{ role: "user", content: "secret prompt" }] },
      providerResponse: { choices: [{ message: { content: "secret answer" } }] },
      response: { content: "secret answer" },
    }];
    const out = stripDetails(details)[0];
    expect(out.id).toBe("abc");
    expect(out.provider).toBe("opencode");
    expect(out.model).toBe("deepseek-v4-flash-free");
    expect(out.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(out.request).toBeUndefined();
    expect(out.providerRequest).toBeUndefined();
    expect(out.providerResponse).toBeUndefined();
    expect(out.response).toBeUndefined();
    expect(out.hasDetail).toBe(true);
    expect(out.payloadBytes).toBeGreaterThan(0);
  });

  it("handles empty details", () => {
    expect(stripDetails([])).toEqual([]);
    expect(stripDetails(null)).toEqual([]);
  });

  it("keeps non-sensitive fields untouched", () => {
    const details = [{ id: "x", status: "error", latency: { total: 100 } }];
    const out = stripDetails(details)[0];
    expect(out.id).toBe("x");
    expect(out.status).toBe("error");
    expect(out.latency).toEqual({ total: 100 });
    expect(out.hasDetail).toBe(true);
    expect(out.payloadBytes).toBe(0);
  });
});
