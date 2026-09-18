// GLM / Z.AI error classification, pinned to payloads captured from the LIVE
// provider on 2026-09-18 — not invented shapes.
//
// Live probe against open.bigmodel.cn returned HTTP/2 429 whose headers carry
// NO retry-after (only date, content-type, alt-svc, set-cookie, ga-traceid,
// vary, x-log-id, hsts) and whose bodies are:
//
//   {"error":{"code":"1302","message":"Rate limit reached for requests"}}
//   {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
//
// 1302 is a transient rate limit; 1113 means the account is out of credit and
// NO amount of retrying will fix it. Both arrive as 429, so without explicit
// rules they are indistinguishable and 1113 gets retried forever.
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { parseUpstreamError, createErrorResult } from "open-sse/utils/error.js";

const GLM_RATE_LIMIT = JSON.stringify({ error: { code: "1302", message: "Rate limit reached for requests" } });
const GLM_NO_BALANCE = JSON.stringify({ error: { code: "1113", message: "余额不足或无可用资源包,请充值。" } });

describe("GLM 429s carry no cooldown of their own", () => {
  it("has neither Retry-After nor a body cooldown field", async () => {
    const res = new Response(GLM_RATE_LIMIT, { status: 429, headers: { "content-type": "application/json" } });
    const { statusCode, resetsAtMs } = await parseUpstreamError(res);
    expect(statusCode).toBe(429);
    // This is why passthrough alone cannot fix Z.AI — there is nothing to pass.
    expect(resetsAtMs).toBeUndefined();
  });
});

describe("terminal billing errors are not retried", () => {
  it("classifies GLM 1113 (insufficient balance) as terminal", () => {
    const r = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(r.terminal).toBe(true);
    // Terminal states must not enter the exponential 429 backoff ladder.
    expect(r.newBackoffLevel).toBeUndefined();
  });

  it("classifies an English insufficient-balance body as terminal", () => {
    expect(checkFallbackError(429, "Insufficient balance, please top up").terminal).toBe(true);
  });

  it("treats HTTP 402 as terminal", () => {
    expect(checkFallbackError(402, "payment required").terminal).toBe(true);
  });

  it("does NOT mark a real rate limit as terminal", () => {
    const r = checkFallbackError(429, GLM_RATE_LIMIT, 0);
    expect(r.terminal).toBeFalsy();
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("keeps billing ahead of rate-limit matching", () => {
    // A body containing BOTH must classify as terminal, never as a retry.
    const mixed = JSON.stringify({ error: { message: "rate limit — 余额不足,请充值" } });
    expect(checkFallbackError(429, mixed).terminal).toBe(true);
  });
});

describe("synthesized cooldown escalates for transient limits", () => {
  it("grows with the backoff level", () => {
    const first = checkFallbackError(429, GLM_RATE_LIMIT, 0);
    const later = checkFallbackError(429, GLM_RATE_LIMIT, 4);
    expect(later.cooldownMs).toBeGreaterThan(first.cooldownMs);
    expect(later.newBackoffLevel).toBe(5);
  });

  it("produces a Retry-After a client can honor", () => {
    // The end-to-end point: a GLM rate limit that arrived with no cooldown
    // still reaches the client with a usable Retry-After.
    const { cooldownMs, terminal } = checkFallbackError(429, GLM_RATE_LIMIT, 3);
    expect(terminal).toBeFalsy();
    const res = createErrorResult(429, "Rate limit reached for requests", Date.now() + cooldownMs).response;
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("advertises no retry for a terminal billing error", () => {
    // chatCore skips synthesis when terminal, so no header is emitted.
    const { terminal } = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(terminal).toBe(true);
    const res = createErrorResult(429, "insufficient balance").response;
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});
