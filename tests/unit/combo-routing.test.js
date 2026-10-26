import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  getRotatedModels,
  resetComboRotation,
  getComboModelsFromData,
  handleComboChat,
} from "../../open-sse/services/combo.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });
});

/**
 * The advertised ladder — README.md:61 / :769, "Auto fallback - Subscription →
 * Cheap → Free" — is asserted nowhere else in this tree; the existing proofs are
 * single-hop (`base-executor-retry.test.js` = per-provider URL retry,
 * `antigravity-quota-routing.test.js` = per-provider account skip).
 *
 * Honest scope note: in THIS tree the ladder is not an automatic provider-tier
 * inference. There is no subscription/cheap/free taxonomy in the codebase. The
 * ladder is ordinary combo DATA: a combo is an ordered list of `provider/model`
 * strings, and `handleComboChat` walks that list in order, advancing to the next
 * entry whenever `checkFallbackError` classifies the answer as fallback-eligible
 * (429/quota/5xx/...). So "the tier order" IS the configured combo order, and
 * these tests exercise the supported configuration path end to end:
 * combo data -> getComboModelsFromData -> handleComboChat.
 *
 * The only thing faked is the transport seam `handleSingleModel`, which in
 * production is `handleSingleModelChat` (real provider call + per-provider
 * account fallback). No network, no timers, no external service is touched; the
 * routing decision under test is production code.
 */

const TIERS = [
  { tier: "subscription", model: "anthropic/claude-sonnet-4", provider: "anthropic" },
  { tier: "cheap", model: "deepseek/deepseek-chat", provider: "deepseek" },
  { tier: "free", model: "opencode/gpt-5-nano-free", provider: "opencode" },
];

const LADDER = TIERS.map((t) => t.model);

const body = {
  model: "tier-ladder",
  messages: [{ role: "user", content: "hello" }],
};

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Upstream answer for an exhausted account (quota gone), shaped like the real
// provider error responses chatCore surfaces to the combo walker.
function exhaustedResponse(tier) {
  return new Response(
    JSON.stringify({
      error: {
        message: `Rate limit exceeded: ${tier.provider} ${tier.tier} tier quota exhausted`,
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    }),
    { status: 429, headers: { "Content-Type": "application/json" } }
  );
}

function successResponse(tier) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-ladder",
      choices: [{ message: { role: "assistant", content: `${tier.tier} tier answered` } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Transport seam (mocked): records every model it is asked to run and answers
// per the health map. `healthy` holds the tier names that answer 200.
function makeTransport(healthy) {
  const attempted = [];
  const fn = vi.fn(async (_body, modelStr) => {
    attempted.push(modelStr);
    const tier = TIERS.find((t) => t.model === modelStr);
    if (!tier) throw new Error(`transport asked for unconfigured model: ${modelStr}`);
    return healthy.has(tier.tier) ? successResponse(tier) : exhaustedResponse(tier);
  });
  return { fn, attempted };
}

// Provider identity via production parsing, not a hand-rolled split.
const providersOf = (models) => models.map((m) => parseModel(m).provider);

describe("combo fallback ladder (advertised subscription -> cheap -> free)", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("drives an exhausted subscription tier into cheap, then free, asserting the provider at each hop", async () => {
    const combosData = [{ name: "tier-ladder", models: LADDER }];
    const models = getComboModelsFromData("tier-ladder", combosData);

    // The configuration path is real: the ordered combo data is what the router walks.
    expect(models).toEqual(LADDER);
    expect(providersOf(models)).toEqual(["anthropic", "deepseek", "opencode"]);

    // Subscription + cheap are exhausted; only the free tier answers.
    const { fn, attempted } = makeTransport(new Set(["free"]));

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel: fn,
      log,
      comboName: "tier-ladder",
      comboStrategy: "fallback",
    });

    // Selected provider at each hop, in order, with no skips and no repeats.
    expect(attempted).toEqual(LADDER);
    expect(providersOf(attempted)).toEqual(["anthropic", "deepseek", "opencode"]);

    // Two failures had to happen before the answer: a one-hop stop would have
    // returned the cheap tier's 429 and never reached the free tier.
    expect(attempted).toHaveLength(3);
    expect(providersOf(attempted).at(-1)).toBe("opencode");

    // The final hop is the one that actually succeeded.
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(payload.choices[0].message.content).toBe("free tier answered");
  });

  it("never selects a failed tier twice", async () => {
    const models = getComboModelsFromData("tier-ladder", [{ name: "tier-ladder", models: LADDER }]);
    const { fn, attempted } = makeTransport(new Set(["free"]));

    await handleComboChat({
      body,
      models,
      handleSingleModel: fn,
      log,
      comboName: "tier-ladder",
      comboStrategy: "fallback",
    });

    for (const tier of TIERS) {
      expect(attempted.filter((m) => m === tier.model)).toHaveLength(1);
    }
    expect(new Set(attempted).size).toBe(attempted.length);
  });

  it("stops at the first healthy tier and does not spend the free tier after cheap answers", async () => {
    const models = getComboModelsFromData("tier-ladder", [{ name: "tier-ladder", models: LADDER }]);
    const { fn, attempted } = makeTransport(new Set(["cheap"]));

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel: fn,
      log,
      comboName: "tier-ladder",
      comboStrategy: "fallback",
    });

    expect(providersOf(attempted)).toEqual(["anthropic", "deepseek"]);
    expect(attempted).not.toContain(TIERS[2].model);
    expect(result.ok).toBe(true);
    expect(parseModel(attempted.at(-1)).provider).toBe("deepseek");
  });

  it("negative control: the ladder is the configured order, not an inferred tier ranking", async () => {
    // Same health map (only the free tier answers) but the combo order is
    // reversed: if selection followed the configured data, the free tier is
    // asked FIRST and the walk stops after one hop. Any implementation that
    // ignored the configured order — or that re-sorted an assumed
    // subscription/cheap/free ranking — would produce a different sequence.
    const reversed = [...LADDER].reverse();
    const models = getComboModelsFromData("tier-ladder-reversed", [
      { name: "tier-ladder-reversed", models: reversed },
    ]);
    expect(models).toEqual(reversed);

    const { fn, attempted } = makeTransport(new Set(["free"]));

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel: fn,
      log,
      comboName: "tier-ladder-reversed",
      comboStrategy: "fallback",
    });

    expect(attempted).toEqual([TIERS[2].model]);
    expect(providersOf(attempted)).toEqual(["opencode"]);
    expect(result.ok).toBe(true);
  });

  it("reports tier exhaustion when every hop fails, inventing no extra tier", async () => {
    const models = getComboModelsFromData("tier-ladder", [{ name: "tier-ladder", models: LADDER }]);
    const { fn, attempted } = makeTransport(new Set());

    const result = await handleComboChat({
      body,
      models,
      handleSingleModel: fn,
      log,
      comboName: "tier-ladder",
      comboStrategy: "fallback",
    });

    expect(attempted).toEqual(LADDER);
    expect(providersOf(attempted)).toEqual(["anthropic", "deepseek", "opencode"]);
    expect(result.ok).toBe(false);
    // Last status survives the walk (429 from the free tier), not a fabricated success.
    expect(result.status).toBe(429);
    const payload = await result.json();
    expect(payload.error.message).toContain("anthropic/claude-sonnet-4 (429): Rate limit exceeded: anthropic subscription tier quota exhausted");
    expect(payload.error.message).toContain("deepseek/deepseek-chat (429): Rate limit exceeded: deepseek cheap tier quota exhausted");
    expect(payload.error.message).toContain("opencode/gpt-5-nano-free (429): Rate limit exceeded: opencode free tier quota exhausted");
    expect(payload.error.type).toBe("server_error");
    expect(payload.error.attempts).toEqual([
      {
        seat_id: "anthropic/claude-sonnet-4",
        status: 429,
        error_message: "Rate limit exceeded: anthropic subscription tier quota exhausted",
      },
      {
        seat_id: "deepseek/deepseek-chat",
        status: 429,
        error_message: "Rate limit exceeded: deepseek cheap tier quota exhausted",
      },
      {
        seat_id: "opencode/gpt-5-nano-free",
        status: 429,
        error_message: "Rate limit exceeded: opencode free tier quota exhausted",
      },
    ]);
  });
});
