import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const response = (message, headers = {}, status = 429) => Response.json({ error: { message } }, { status, headers });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("provider-reported rate-limit resets", () => {
  it("keeps a GLM five-hour reset in UTC within the cooldown cap", async () => {
    const result = await parseUpstreamError(response("Usage limit reached. Your limit will reset at 2026-10-16 15:00:00"));
    expect(result.resetsAtMs).toBe(NOW + 5 * 3600000);
    expect(result.resetsAtMs - NOW).toBeLessThanOrEqual(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it.each([
    ["retry in 30 seconds", 30000],
    ["resets in 5 minutes", 300000],
    ["try again after 1.5 hours", 5400000],
  ])("parses the relative reset: %s", async (message, delay) => {
    expect((await parseUpstreamError(response(message))).resetsAtMs).toBe(NOW + delay);
  });

  it.each([
    ["120", NOW + 120000],
    ["Fri, 16 Oct 2026 11:00:00 GMT", NOW + 3600000],
  ])("uses Retry-After with an empty body: %s", async (value, reset) => {
    const result = await parseUpstreamError(new Response(null, { status: 429, headers: { "retry-after": value } }));
    expect(result.resetsAtMs).toBe(reset);
  });

  it("fills an executor's missing reset while retaining its message", async () => {
    const executor = { parseError: () => ({ status: 429, message: "custom quota message" }) };
    const result = await parseUpstreamError(response("unparsed", { "retry-after": "600" }), executor);
    expect(result).toMatchObject({ message: "custom quota message", resetsAtMs: NOW + 600000 });
  });

  it("keeps the executor-specific reset ahead of generic hints", async () => {
    const reset = NOW + 3 * 3600000;
    const executor = { parseError: () => ({ status: 429, message: "retry in 1 minute", resetsAtMs: reset }) };
    expect((await parseUpstreamError(response("unparsed", { "retry-after": "60" }), executor)).resetsAtMs).toBe(reset);
  });

  it("ignores unknown or expired resets and does not change non-429 errors", async () => {
    for (const message of ["busy", "Your limit will reset at 2026-10-15 15:00:00"]) {
      expect((await parseUpstreamError(response(message))).resetsAtMs).toBeUndefined();
    }
    expect((await parseUpstreamError(response("retry in 5 hours", {}, 400))).resetsAtMs).toBeUndefined();
  });
});
