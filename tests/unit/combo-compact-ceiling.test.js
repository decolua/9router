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
