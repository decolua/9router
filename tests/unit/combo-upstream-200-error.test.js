import { describe, it, expect } from "vitest";

import { detectUpstreamError } from "../../open-sse/services/combo.js";

// Helper to build a Response-like object with a JSON body
function jsonResponse(body, { status = 200, contentType = "application/json" } = {}) {
  const headers = new Map();
  headers.get = (k) => (k.toLowerCase() === "content-type" ? contentType : null);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    clone() {
      return jsonResponse(body, { status, contentType });
    },
    async json() {
      return body;
    },
  };
}

describe("detectUpstreamError (#3242)", () => {
  it("returns null for a real success body", async () => {
    const res = jsonResponse({ id: "x", choices: [{ message: { content: "hi" } }] });
    expect(await detectUpstreamError(res)).toBeNull();
  });

  it("detects { error: '...' } inside a 200 response", async () => {
    const res = jsonResponse({ error: "quota exceeded" });
    expect(await detectUpstreamError(res)).toBe("quota exceeded");
  });

  it("detects { error: { message } } nested", async () => {
    const res = jsonResponse({ error: { message: "rate limited" } });
    expect(await detectUpstreamError(res)).toBe("rate limited");
  });

  it("detects { message: '...' } inside a 200 response", async () => {
    const res = jsonResponse({ message: "upstream unavailable" });
    expect(await detectUpstreamError(res)).toBe("upstream unavailable");
  });

  it("returns null for non-JSON content-type", async () => {
    const res = jsonResponse("plain text", { contentType: "text/plain" });
    expect(await detectUpstreamError(res)).toBeNull();
  });

  it("returns null for an already non-ok status (handled elsewhere)", async () => {
    const res = jsonResponse({ error: "x" }, { status: 503 });
    expect(await detectUpstreamError(res)).toBeNull();
  });
});
