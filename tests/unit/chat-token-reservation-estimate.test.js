import { describe, expect, it } from "vitest";

let estimateChatUsageReservation;
try {
  ({ estimateChatUsageReservation } = await import("@/sse/services/usageReservation.js"));
} catch (error) {
  if (!/usageReservation/.test(error.message)) throw error;
}

function expectedTotal(body, outputTokens) {
  return Buffer.byteLength(JSON.stringify(body), "utf8") + outputTokens;
}

describe("chat usage reservation estimate", () => {
  it("uses UTF-8 serialized request bytes and the 64000 default", () => {
    const body = { model: "openai/gpt-4o", messages: [{ role: "user", content: "cafe \u2615" }] };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(estimateChatUsageReservation(body)).toBe(expectedTotal(body, 64_000));
    expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBeGreaterThan(JSON.stringify(body).length);
  });

  it.each([
    ["max_tokens", { max_tokens: 101 }, 101],
    ["max_completion_tokens", { max_completion_tokens: 102 }, 102],
    ["max_output_tokens", { max_output_tokens: 103 }, 103],
    ["generationConfig.maxOutputTokens", { generationConfig: { maxOutputTokens: 104 } }, 104],
    ["thinking.budget_tokens", { thinking: { budget_tokens: 105 } }, 1_129],
  ])("uses positive safe integer %s", (_name, fields, outputTokens) => {
    const body = { model: "test/model", messages: [], ...fields };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(estimateChatUsageReservation(body)).toBe(expectedTotal(body, outputTokens));
  });

  it("uses the largest valid output reservation", () => {
    const body = {
      max_tokens: 100,
      max_completion_tokens: 200,
      max_output_tokens: 300,
      generationConfig: { maxOutputTokens: 400 },
      thinking: { budget_tokens: 500 },
    };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(estimateChatUsageReservation(body)).toBe(expectedTotal(body, 1_524));
  });

  it("reserves the deterministic 32000-token tool output minimum", () => {
    const body = {
      model: "openai/gpt-4o",
      messages: [],
      max_tokens: 1,
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
    };

    expect(estimateChatUsageReservation(body)).toBe(expectedTotal(body, 32_000));
  });

  it("reserves Cursor's translated 32000-token ceiling for low explicit candidates", () => {
    const body = {
      model: "cursor/cursor-model",
      messages: [],
      max_tokens: 1,
      max_completion_tokens: 2,
      max_output_tokens: 3,
      generationConfig: { maxOutputTokens: 4 },
    };
    expect(estimateChatUsageReservation(body, { provider: "cursor", model: "cursor-model" }))
      .toBe(expectedTotal(body, 32_000));
  });

  it("reserves Claude's translated 64000 default when max_tokens is absent", () => {
    const body = {
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [],
      max_completion_tokens: 1,
      max_output_tokens: 2,
      generationConfig: { maxOutputTokens: 3 },
    };
    expect(estimateChatUsageReservation(body, { provider: "anthropic", model: "claude-sonnet-4-20250514" }))
      .toBe(expectedTotal(body, 64_000));
  });

  it("keeps Claude's low explicit max_tokens when translation keeps it", () => {
    const body = {
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [],
      max_tokens: 7,
    };
    expect(estimateChatUsageReservation(body, { provider: "anthropic", model: "claude-sonnet-4-20250514" }))
      .toBe(expectedTotal(body, 7));
  });

  it("reserves a dynamic Anthropic-compatible provider's translated 64000 ceiling", () => {
    const body = {
      model: "anthropic-compatible-team/claude-custom",
      messages: [],
      max_completion_tokens: 1,
    };

    expect(estimateChatUsageReservation(body, {
      provider: "anthropic-compatible-team",
      model: "claude-custom",
    })).toBe(expectedTotal(body, 64_000));
  });

  it.each([
    [
      "Kiro",
      "kiro",
      "claude-sonnet-4.6",
      { max_tokens: 1, max_completion_tokens: 2, max_output_tokens: 3 },
      32_000,
    ],
    [
      "CommandCode",
      "commandcode",
      "deepseek/deepseek-v4-pro",
      { max_completion_tokens: 1, generationConfig: { maxOutputTokens: 2 } },
      64_000,
    ],
  ])("reserves %s's effective translated output ceiling", (_name, provider, model, fields, outputTokens) => {
    const body = { model: `${provider}/${model}`, messages: [], ...fields };

    expect(estimateChatUsageReservation(body, { provider, model }))
      .toBe(expectedTotal(body, outputTokens));
  });

  it("ignores invalid output values and falls back to 64000", () => {
    const body = {
      max_tokens: 0,
      max_completion_tokens: -1,
      max_output_tokens: 1.5,
      generationConfig: { maxOutputTokens: "200" },
      thinking: { budget_tokens: Number.POSITIVE_INFINITY },
    };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(estimateChatUsageReservation(body)).toBe(expectedTotal(body, 64_000));
  });

  it("rejects total estimate overflow", () => {
    const body = { max_tokens: Number.MAX_SAFE_INTEGER };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(() => estimateChatUsageReservation(body)).toThrow("token reservation estimate exceeds safe integer range");
  });

  it("rejects thinking headroom overflow", () => {
    const body = { thinking: { budget_tokens: Number.MAX_SAFE_INTEGER - 1_000 } };

    expect(estimateChatUsageReservation).toBeTypeOf("function");
    expect(() => estimateChatUsageReservation(body)).toThrow("token reservation estimate exceeds safe integer range");
  });
});
