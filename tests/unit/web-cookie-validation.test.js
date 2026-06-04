/**
 * Unit tests for grok-web & perplexity-web cookie validation logic
 *
 * Covers:
 *  - Cookie prefix stripping (sso=, __Secure-next-auth.session-token=)
 *  - 401/403 → invalid with error message
 *  - Non-auth responses (200, 400, 429) → valid (Cloudflare-bypass probe)
 *  - Required browser-fingerprint headers sent to Grok
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

// Replicates the validation logic from app/src/app/api/providers/validate/route.js
async function validateGrokWeb(apiKey) {
  const token = apiKey.startsWith("sso=") ? apiKey.slice(4) : apiKey;
  const randomHex = (n) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const statsigId = Buffer.from("e:TypeError: Cannot read properties of null (reading 'children')").toString("base64");
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const res = await fetch("https://grok.com/rest/app-chat/conversations/new", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Cookie: `sso=${token}`,
      Origin: "https://grok.com",
      Referer: "https://grok.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "x-statsig-id": statsigId,
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`,
    },
    body: JSON.stringify({ temporary: true, modelName: "grok-4", message: "ping" }),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, error: "Invalid SSO cookie — re-paste from grok.com DevTools → Cookies → sso" };
  }
  return { valid: true, error: null };
}

async function validatePerplexityWeb(apiKey) {
  let sessionToken = apiKey;
  if (sessionToken.startsWith("__Secure-next-auth.session-token=")) {
    sessionToken = sessionToken.slice("__Secure-next-auth.session-token=".length);
  }
  const res = await fetch("https://www.perplexity.ai/rest/sse/perplexity_ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Origin: "https://www.perplexity.ai",
      Referer: "https://www.perplexity.ai/",
      Cookie: `__Secure-next-auth.session-token=${sessionToken}`,
    },
    body: JSON.stringify({ query_str: "ping" }),
  });
  if (res.status === 401 || res.status === 403) {
    return { valid: false, error: "Invalid session cookie — re-paste __Secure-next-auth.session-token from perplexity.ai" };
  }
  return { valid: true, error: null };
}

describe("grok-web validation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it("should return valid:true when response is 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    const result = await validateGrokWeb("test-token");
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("should return valid:true when response is 400 (auth accepted but bad body)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 400 });
    const result = await validateGrokWeb("test-token");
    expect(result.valid).toBe(true);
  });

  it("should return valid:true when response is 429 (rate limited but auth ok)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 429 });
    const result = await validateGrokWeb("test-token");
    expect(result.valid).toBe(true);
  });

  it("should return valid:false with error when response is 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 401 });
    const result = await validateGrokWeb("bad-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid SSO cookie");
  });

  it("should return valid:false with error when response is 403", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 403 });
    const result = await validateGrokWeb("bad-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid SSO cookie");
  });

  it("should strip sso= prefix from apiKey", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("sso=abc123");
    const callArgs = global.fetch.mock.calls[0][1];
    expect(callArgs.headers.Cookie).toBe("sso=abc123");
  });

  it("should accept raw token without sso= prefix", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("abc123");
    const callArgs = global.fetch.mock.calls[0][1];
    expect(callArgs.headers.Cookie).toBe("sso=abc123");
  });

  it("should POST to /rest/app-chat/conversations/new", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("token");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://grok.com/rest/app-chat/conversations/new",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should send Cloudflare-bypass headers", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validateGrokWeb("token");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Origin).toBe("https://grok.com");
    expect(headers.Referer).toBe("https://grok.com/");
    expect(headers["User-Agent"]).toContain("Chrome");
    expect(headers["x-statsig-id"]).toBeTruthy();
    expect(headers["x-xai-request-id"]).toBeTruthy();
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  });
});

describe("perplexity-web validation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it("should return valid:true when response is 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    const result = await validatePerplexityWeb("test-token");
    expect(result.valid).toBe(true);
  });

  it("should return valid:false when response is 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 401 });
    const result = await validatePerplexityWeb("bad-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid session cookie");
  });

  it("should return valid:false when response is 403", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 403 });
    const result = await validatePerplexityWeb("bad-token");
    expect(result.valid).toBe(false);
  });

  it("should strip __Secure-next-auth.session-token= prefix", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validatePerplexityWeb("__Secure-next-auth.session-token=xyz789");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Cookie).toBe("__Secure-next-auth.session-token=xyz789");
  });

  it("should accept raw token without prefix", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validatePerplexityWeb("xyz789");
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Cookie).toBe("__Secure-next-auth.session-token=xyz789");
  });

  it("should POST to /rest/sse/perplexity_ask", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await validatePerplexityWeb("token");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://www.perplexity.ai/rest/sse/perplexity_ask",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
