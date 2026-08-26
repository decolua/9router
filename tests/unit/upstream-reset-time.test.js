import { describe, expect, it } from "vitest";
import { extractResetsAtMs } from "../../open-sse/utils/error.js";

const res = (headers = {}) => ({ status: 429, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const secs = (ms) => Math.round((ms - Date.now()) / 1000);

// markAccountUnavailable has always honoured a stated reset; nothing outside
// codex/antigravity ever produced one, so every other provider took the flat
// 12h quota cooldown. These are the shapes actually seen in production.
describe("extractResetsAtMs — believe the provider's own reset time", () => {
  it("reads Retry-After as a delta in seconds", () => {
    expect(secs(extractResetsAtMs(res({ "retry-after": "120" }), ""))).toBeGreaterThanOrEqual(119);
  });

  it("reads X-RateLimit-Reset as epoch seconds", () => {
    const at = Math.floor(Date.now() / 1000) + 3600;
    expect(secs(extractResetsAtMs(res({ "x-ratelimit-reset": String(at) }), ""))).toBeGreaterThan(3500);
  });

  it("reads epoch millis without mistaking them for a delta", () => {
    const at = Date.now() + 7200_000;
    expect(extractResetsAtMs(res({ "x-ratelimit-reset": String(at) }), "")).toBe(at);
  });

  it("reads a reset echoed into OpenRouter's body metadata", () => {
    const at = Math.floor(Date.now() / 1000) + 1800;
    const body = JSON.stringify({ error: { code: 429, metadata: { headers: { "X-RateLimit-Reset": String(at) } } } });
    expect(secs(extractResetsAtMs(res(), body))).toBeGreaterThan(1700);
  });

  it("reads resets_in_seconds", () => {
    const body = JSON.stringify({ error: { resets_in_seconds: 600 } });
    expect(secs(extractResetsAtMs(res(), body))).toBeGreaterThanOrEqual(599);
  });

  // The opencode-go case: the only statement of the reset is prose. It cost
  // 12 hours against a limit that said it returned in about one.
  it("reads a duration stated only in prose", () => {
    const body = '{"type":"error","error":{"type":"GoUsageLimitError","message":"Monthly usage limit reached. Resets in 1h 6m"}}';
    const s = secs(extractResetsAtMs(res(), body));
    expect(s).toBeGreaterThan(3500);
    expect(s).toBeLessThan(3700);
  });

  it("returns null when the provider says nothing, so the default still applies", () => {
    const body = '{"error":{"message":"Rate limit exceeded: free-models-per-day-stealth. "}}';
    expect(extractResetsAtMs(res(), body)).toBeNull();
  });

  it("ignores a reset already in the past", () => {
    expect(extractResetsAtMs(res({ "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 500) }), "")).toBeNull();
  });
});
