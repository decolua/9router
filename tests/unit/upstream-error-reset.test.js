import { describe, expect, it } from "vitest";
import { parseUpstreamError, resetsAtFromHeaders } from "open-sse/utils/error.js";

const CLAUDE_429 = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "This request would exceed your account's rate limit" } });

function res(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

describe("provider-declared rate limit reset (headers)", () => {
  it("anthropic-ratelimit-unified-reset (epoch seconds) → resetsAtMs", async () => {
    const resetEpochSec = Math.floor(Date.now() / 1000) + 6060; // ~1h41m
    const r = await parseUpstreamError(res(429, CLAUDE_429, { "anthropic-ratelimit-unified-reset": String(resetEpochSec) }));
    expect(r.statusCode).toBe(429);
    expect(r.resetsAtMs).toBe(resetEpochSec * 1000);
  });

  it("retry-after in delta seconds → resetsAtMs", async () => {
    const before = Date.now();
    const r = await parseUpstreamError(res(429, CLAUDE_429, { "retry-after": "120" }));
    expect(r.resetsAtMs).toBeGreaterThanOrEqual(before + 120000);
    expect(r.resetsAtMs).toBeLessThanOrEqual(Date.now() + 121000);
  });

  it("retry-after as HTTP-date → resetsAtMs", async () => {
    const future = new Date(Date.now() + 300000);
    const r = await parseUpstreamError(res(429, CLAUDE_429, { "retry-after": future.toUTCString() }));
    // toUTCString truncates ms
    expect(Math.abs(r.resetsAtMs - future.getTime())).toBeLessThan(1000);
  });

  it("no reset headers → resetsAtMs undefined (backoff path preserved)", async () => {
    const r = await parseUpstreamError(res(429, CLAUDE_429));
    expect(r.resetsAtMs).toBeUndefined();
    expect(r.message).toContain("rate limit");
  });

  it("reset in the past is ignored", () => {
    const past = String(Math.floor(Date.now() / 1000) - 60);
    expect(resetsAtFromHeaders(res(429, "", { "anthropic-ratelimit-unified-reset": past }))).toBeUndefined();
  });

  it("executor body parse (codex resets_at) wins over headers", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 9000;
    const codexBody = JSON.stringify({ error: { type: "usage_limit_reached", message: "The usage limit has been reached", resets_at: resetsAt } });
    const executor = {
      parseError: (response, bodyText) => {
        const err = JSON.parse(bodyText).error;
        return { status: 429, message: err.message, resetsAtMs: err.resets_at * 1000 };
      },
    };
    const r = await parseUpstreamError(res(429, codexBody, { "retry-after": "60" }), executor);
    expect(r.resetsAtMs).toBe(resetsAt * 1000);
  });

  it("executor parse without resetsAtMs falls back to header reset", async () => {
    const executor = { parseError: (response, bodyText) => ({ status: response.status, message: bodyText }) };
    const before = Date.now();
    const r = await parseUpstreamError(res(429, "The usage limit has been reached", { "retry-after": "3600" }), executor);
    expect(r.resetsAtMs).toBeGreaterThanOrEqual(before + 3600000);
  });
});
