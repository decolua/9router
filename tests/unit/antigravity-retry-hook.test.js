// Guards D3: antigravity 429/503 retry merged into base via computeRetryDelay hook.
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

const MAX = 10000;
function res(status, headers = {}, body = null) {
  return {
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    clone: () => ({ text: async () => (body == null ? "" : JSON.stringify(body)) }),
  };
}

describe("antigravity computeRetryDelay hook (D3)", () => {
  const ag = new AntigravityExecutor();

  it("uses Retry-After header (seconds → ms) when within cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "5" }), 1)).toBe(5000);
  });

  it("vetoes (false) when Retry-After exceeds cap", async () => {
    expect(await ag.computeRetryDelay(res(429, { "retry-after": "60" }), 1)).toBe(false);
  });

  it("parses retry time from error body when no header", async () => {
    const r = res(429, {}, { error: { message: "quota will reset after 3s" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(3000);
  });

  it("preserves the exact Google quota reset timestamp for account cooldown", () => {
    const resetAt = "2099-07-22T07:06:58Z";
    const parsed = ag.parseError({ status: 429 }, JSON.stringify({
      error: {
        code: 429,
        message: "You have exhausted your capacity on this model.",
        details: [{ metadata: { quotaResetTimeStamp: resetAt } }],
      },
    }));

    expect(parsed).toMatchObject({
      status: 429,
      message: "You have exhausted your capacity on this model.",
      resetsAtMs: Date.parse(resetAt),
    });
  });

  it("converts Google RetryInfo into an absolute account cooldown", () => {
    const before = Date.now();
    const parsed = ag.parseError({ status: 429 }, JSON.stringify({
      error: {
        code: 429,
        message: "Rate limited",
        details: [{ retryDelay: "7200.5s" }],
      },
    }));

    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(before + 7_200_500);
    expect(parsed.resetsAtMs).toBeLessThanOrEqual(Date.now() + 7_200_500);
  });

  it("exponential backoff for 429 when no retry info", async () => {
    expect(await ag.computeRetryDelay(res(429), 1)).toBe(Math.min(1000 * 2 ** 1, MAX));
    expect(await ag.computeRetryDelay(res(429), 3)).toBe(Math.min(1000 * 2 ** 3, MAX));
  });

  it("503 without retry info → transient backoff", async () => {
    expect(await ag.computeRetryDelay(res(503), 1)).toBe(2000);
  });

  it("retries Antigravity agent terminated body even when status is not 429", async () => {
    const r = res(500, {}, { error: { message: "Agent execution terminated due to error" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(2000);
  });

  it("retries high traffic body", async () => {
    const r = res(500, {}, { error: { message: "Our servers are experiencing high traffic" } });
    expect(await ag.computeRetryDelay(r, 2)).toBe(4000);
  });

  it("does not retry non-transient 400 errors", async () => {
    const r = res(400, {}, { error: { message: "Invalid request" } });
    expect(await ag.computeRetryDelay(r, 1)).toBe(false);
  });

  it("deduplicates sanitized tool names", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [
          { name: "read/file", parameters: { type: "object", properties: {} } },
          { name: "read file", parameters: { type: "object", properties: {} } },
          { name: "read/file", parameters: { type: "object", properties: {} } },
        ] }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.request.tools[0].functionDeclarations.map(fn => fn.name)).toEqual(["read_file"]);
  });

  it("registry uses the official IDE cloudcode host and user agent", () => {
    expect(antigravity.transport.baseUrls).toEqual(["https://cloudcode-pa.googleapis.com"]);
    expect(antigravity.transport.headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
  });

  it("buildHeaders matches official IDE stream headers", () => {
    ag._lastSessionId = "sess-123";
    const h = ag.buildHeaders({ accessToken: "tok" }, true);
    expect(h["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["Authorization"]).toBe("Bearer tok");
    expect(h).not.toHaveProperty("X-Machine-Session-Id");
    expect(h).not.toHaveProperty("x-request-source");
    expect(h).not.toHaveProperty("Accept");
  });

  it("transforms chat requests with official IDE requestId shape and 64000 token cap", () => {
    const out = ag.transformRequest("claude-opus-4-6-thinking", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "hi" }] },
          { role: "model", parts: [{ text: "hello" }] },
        ],
        generationConfig: { maxOutputTokens: 90000 },
        sessionId: "-3750763034362895579",
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.requestId).toMatch(/^agent\/[0-9a-f-]{36}\/\d{13}\/[0-9a-f-]{36}\/\d+$/);
    expect(out.request.generationConfig.maxOutputTokens).toBe(64000);
  });

  it("preserves multiple inline reference images for image generation", () => {
    const out = ag.transformRequest("gemini-3.1-flash-image", {
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: "AAAA" } },
          { inlineData: { mimeType: "image/jpeg", data: "BBBB" } },
          { text: "Combine them" },
        ],
      }],
    }, false, { projectId: "project-1", connectionId: "conn-1" });

    expect(out.request.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "AAAA" } },
      { inlineData: { mimeType: "image/jpeg", data: "BBBB" } },
      { text: "Combine them" },
    ]);
    expect(out.request.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(out.requestType).toBe("image_gen");
    expect(antigravity.models.find((model) => model.id === "gemini-3.1-flash-image")?.capabilities)
      .toEqual(expect.arrayContaining(["edit", "multiImage"]));
  });
});
