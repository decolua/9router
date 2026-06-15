// Guards D3: antigravity 429/503 retry merged into base via computeRetryDelay hook.
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

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

  it("exponential backoff for 429 when no retry info", async () => {
    expect(await ag.computeRetryDelay(res(429), 1)).toBe(Math.min(1000 * 2 ** 1, MAX));
    expect(await ag.computeRetryDelay(res(429), 3)).toBe(Math.min(1000 * 2 ** 3, MAX));
  });

  it("503 without retry info → veto (no auto backoff)", async () => {
    expect(await ag.computeRetryDelay(res(503), 1)).toBe(false);
  });

  it("buildHeaders includes cached session id after transformRequest", () => {
    ag._lastSessionId = "sess-123";
    const h = ag.buildHeaders({ accessToken: "tok" }, true);
    expect(h["X-Machine-Session-Id"]).toBe("sess-123");
  });
});
