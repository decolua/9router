import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

const saveRequestUsage = vi.fn(async () => {});

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage,
}));

const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

describe("fast-mode usage pricing", () => {
  beforeEach(() => {
    saveRequestUsage.mockClear();
  });

  it("applies the request pricing multiplier to calculated cost", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 50, pricing_multiplier: 2 },
      { input: 3, output: 15 },
    );

    expect(cost).toBeCloseTo(2 * (100 * 3 + 50 * 15) / 1_000_000, 12);
  });

  it("persists the pricing multiplier with canonical usage", () => {
    saveUsageStats({
      provider: "codex",
      model: "gpt-5.6-sol",
      tokens: { input_tokens: 100, output_tokens: 50 },
      pricingMultiplier: 2,
      silent: true,
    });

    expect(saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      model: "gpt-5.6-sol",
      tokens: expect.objectContaining({
        prompt_tokens: 100,
        completion_tokens: 50,
        pricing_multiplier: 2,
      }),
    }));
  });
});
