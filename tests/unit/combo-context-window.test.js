import { describe, expect, it, vi } from "vitest";

import {
  handleComboChat,
  selectContextEligibleModels,
} from "../../open-sse/services/combo.js";

const CAPABILITIES = {
  "small/model": { contextWindow: 100000 },
  "large/model": { contextWindow: 300000 },
};

const resolveCapabilities = (provider, model) => CAPABILITIES[`${provider}/${model}`] ?? null;
const estimateTokens = () => 120000;

describe("selectContextEligibleModels", () => {
  it("drops known undersized members and preserves eligible order", () => {
    const result = selectContextEligibleModels(
      ["small/model", "large/model", "unknown/model"],
      { max_output_tokens: 10000 },
      { resolveCapabilities, estimateTokens, bufferTokens: 2000 },
    );

    expect(result).toEqual({
      models: ["large/model", "unknown/model"],
      skipped: [{ model: "small/model", contextWindow: 100000 }],
      requiredTokens: 132000,
    });
  });

  it("uses a conservative default output allowance when no output limit is requested", () => {
    const result = selectContextEligibleModels(
      ["small/model", "large/model"],
      {},
      { resolveCapabilities, estimateTokens: () => 95000, bufferTokens: 2000 },
    );

    expect(result.requiredTokens).toBe(101096);
    expect(result.models).toEqual(["large/model"]);
  });

  it("preserves compatibility when request size cannot be estimated", () => {
    const models = ["small/model", "large/model"];
    const result = selectContextEligibleModels(
      models,
      {},
      { resolveCapabilities, estimateTokens: () => 0 },
    );

    expect(result).toEqual({
      models,
      skipped: [],
      requiredTokens: null,
    });
  });
});

describe("handleComboChat context eligibility", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  it("never dispatches a request to a known undersized member", async () => {
    const handleSingleModel = vi.fn(async () => Response.json({ ok: true }));

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "large prompt" }], max_tokens: 10000 },
      models: ["small/model", "large/model"],
      handleSingleModel,
      log,
      resolveCapabilities,
      estimateTokens,
    });

    expect(response.ok).toBe(true);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith(expect.any(Object), "large/model");
  });

  it("returns a typed client error without provider dispatch when every known member is undersized", async () => {
    const handleSingleModel = vi.fn();

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "large prompt" }], max_tokens: 10000 },
      models: ["small/model"],
      handleSingleModel,
      log,
      resolveCapabilities,
      estimateTokens,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "combo_context_window_exceeded",
        message: "No Combo member has a known context window large enough for this request.",
        required_tokens_estimate: 132000,
        largest_context_window: 100000,
      },
    });
    expect(handleSingleModel).not.toHaveBeenCalled();
  });
});
