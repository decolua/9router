import { describe, expect, it } from "vitest";

import { comboTokenLimits, splitModelRef } from "../../open-sse/services/comboLimits.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

/**
 * Combo entries in /v1/models carried no token metadata, so a client sizing its
 * context window off the endpoint fell back to guessing from the model name —
 * a 1M pool read as a 128k one, compacting at ~96k (#3486).
 *
 * A request routed to a combo can land on any member, so the pool can only
 * promise what its smallest member accepts.
 */
const capsFor = (ref) => {
  const { alias, modelId } = splitModelRef(ref);
  return getCapabilitiesForModel(alias, modelId);
};

describe("splitModelRef", () => {
  it("splits on the first slash only", () => {
    expect(splitModelRef("openrouter/deepseek/deepseek-chat")).toEqual({
      alias: "openrouter",
      modelId: "deepseek/deepseek-chat",
    });
  });

  it("treats a bare id as having no alias", () => {
    expect(splitModelRef("gpt-5")).toEqual({ alias: "", modelId: "gpt-5" });
  });
});

describe("comboTokenLimits", () => {
  const caps = {
    "a/wide": { contextWindow: 1_000_000, maxOutput: 128_000 },
    "a/narrow": { contextWindow: 128_000, maxOutput: 64_000 },
    "a/silent": {},
  };
  const stub = (ref) => caps[ref];

  it("reports the smallest window in the pool", () => {
    expect(comboTokenLimits(["a/wide", "a/narrow"], stub)).toEqual({
      contextWindow: 128_000,
      maxOutput: 64_000,
    });
  });

  it("is order independent", () => {
    expect(comboTokenLimits(["a/narrow", "a/wide"], stub)).toEqual(
      comboTokenLimits(["a/wide", "a/narrow"], stub),
    );
  });

  it("ignores a member that reports no limits rather than reading it as zero", () => {
    expect(comboTokenLimits(["a/wide", "a/silent"], stub)).toEqual({
      contextWindow: 1_000_000,
      maxOutput: 128_000,
    });
  });

  it("returns nothing to emit when no member reports a limit", () => {
    expect(comboTokenLimits(["a/silent"], stub)).toEqual({
      contextWindow: undefined,
      maxOutput: undefined,
    });
  });

  it("survives an empty, absent or malformed model list", () => {
    const empty = { contextWindow: undefined, maxOutput: undefined };
    expect(comboTokenLimits([], stub)).toEqual(empty);
    expect(comboTokenLimits(undefined, stub)).toEqual(empty);
    expect(comboTokenLimits([null, "", "  ", 7], stub)).toEqual(empty);
  });

  it("mixes a 1M model with a 128k one down to 128k using the real catalog", () => {
    const limits = comboTokenLimits(
      ["anthropic/claude-opus-4.7", "deepseek/deepseek-chat"],
      capsFor,
    );
    expect(limits.contextWindow).toBe(128_000);
  });

  it("keeps the full window when every member is wide", () => {
    const limits = comboTokenLimits(
      ["anthropic/claude-opus-4.7", "anthropic/claude-opus-4.7"],
      capsFor,
    );
    expect(limits.contextWindow).toBe(1_000_000);
  });
});
