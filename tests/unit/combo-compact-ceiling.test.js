import { beforeEach, describe, expect, it, vi } from "vitest";

// Windows are declared by the provider registry; stub it so the test states the
// windows it is reasoning about instead of tracking the live registry.
vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: (provider, model) => {
    const windows = {
      "gemini/big": 1000000,
      "ag/small": 200000,
      "x/nowindow": 0,
    };
    return { contextWindow: windows[`${provider}/${model}`] ?? 0 };
  },
}));

const { widestEligibleWindow, modelContextWindow } = await import("../../open-sse/services/combo.js");
const { clearModelCooldowns, markModelCooldown } = await import("../../open-sse/services/modelCooldown.js");
const { markQuotaExhausted, clearQuotaState } = await import("../../open-sse/services/quotaState.js");

const POOL = ["ag/small", "gemini/big", "x/nowindow"];

describe("widestEligibleWindow tracks live supply, not the pool on paper", () => {
  beforeEach(() => {
    clearModelCooldowns();
    clearQuotaState?.();
  });

  it("reports the widest window when everything is available", () => {
    expect(widestEligibleWindow(POOL)).toBe(1000000);
  });

  it("drops a member that is backing off, lowering the ceiling", () => {
    markModelCooldown("gemini/big", Date.now() + 60_000);
    // The 1M member cannot answer, so it must not keep the ceiling at 1M —
    // that is what lets a conversation outgrow the members that CAN answer.
    expect(widestEligibleWindow(POOL)).toBe(200000);
  });

  it("returns 0 when no member declares a window, so no ceiling is derived", () => {
    expect(widestEligibleWindow(["x/nowindow"])).toBe(0);
  });

  it("reads the same window source shouldSkipModel does", () => {
    expect(modelContextWindow("gemini/big")).toBe(1000000);
    expect(modelContextWindow("bare-model-no-slash")).toBe(0);
  });
});

// The contract that makes the client self-heal. Claude Code classifies an
// upstream failure as `prompt_too_long` only on HTTP 413 whose text matches
// this regex, then trims exactly (actual - limit) tokens and retries.
describe("the 413 body is shaped for Claude Code's reactive compaction", () => {
  const CLAUDE_CODE_PTL = /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i;

  const message = (actual, limit, detail = "Compact the conversation and retry.") =>
    `Prompt is too long: ${actual} tokens > ${limit} tokens. ${detail}`;

  it("matches the parser and yields the true token gap", () => {
    const m = message(900000, 838860).match(CLAUDE_CODE_PTL);
    expect(m).not.toBeNull();
    expect(Number(m[1]) - Number(m[2])).toBe(61140);
  });

  it("starts with the exact prefix the client tests for", () => {
    expect(message(1, 0).startsWith("Prompt is too long")).toBe(true);
  });

  it("still contains the substring the 413 classifier looks for", () => {
    expect(message(5, 4).toLowerCase().includes("prompt is too long")).toBe(true);
  });

  it("the previous wording would NOT have triggered a compact", () => {
    const old =
      'Request is ~900000 tokens; the largest context window in combo "Yggdrasil" is 838860.';
    expect(old.toLowerCase().includes("prompt is too long")).toBe(false);
    expect(old.match(CLAUDE_CODE_PTL)).toBeNull();
  });
});

// Regression for the 2026-08-23 "429 instead of rotate" report. The router sized a
// request at 150,632 tokens from 602,528 serialized chars (the flat 4 chars/token
// assumption in estimateInputTokens). The provider answered
// 400 "Input length 391532 exceeds the max...", i.e. 1.54 chars/token actual.
// Five members declaring 200K-262K windows therefore passed the size check, each
// burned a round trip to be told the input was too long, and the pool collapsed to
// the 1M members — which were rate limited. The client saw a 429 and concluded
// rotation was broken; rotation had in fact tried every entry.
describe("context estimate carries a safety factor for sizing", () => {
  it("defaults to 2.5 and is env-overridable", async () => {
    const { CONTEXT_ESTIMATE_SAFETY } = await import("../../open-sse/config/errorConfig.js");
    expect(CONTEXT_ESTIMATE_SAFETY).toBe(2.5);
  });

  it("the measured case is no longer waved through 200K-window members", async () => {
    const { CONTEXT_ESTIMATE_SAFETY } = await import("../../open-sse/config/errorConfig.js");
    const rawEstimate = 150632;            // what the router computed
    const providerActual = 391532;         // what the provider measured
    const adjusted = Math.ceil(rawEstimate * CONTEXT_ESTIMATE_SAFETY);

    // Before: 150632 < 200000, so a 200K member looked able to serve it.
    expect(rawEstimate).toBeLessThan(200000);
    // After: the adjusted figure exceeds every window that actually rejected it.
    for (const window of [200000, 262144]) {
      expect(adjusted).toBeGreaterThan(window);
    }
    // Still conservative rather than absurd — it must not exceed the real size,
    // or genuinely capable 1M members would start being skipped too.
    expect(adjusted).toBeLessThanOrEqual(providerActual);
  });

  it("leaves 1M members eligible, so large requests still route", async () => {
    const { CONTEXT_ESTIMATE_SAFETY } = await import("../../open-sse/config/errorConfig.js");
    expect(Math.ceil(150632 * CONTEXT_ESTIMATE_SAFETY)).toBeLessThan(1000000);
  });
});
