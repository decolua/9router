// tests/unit/key-pricing.test.js
import { describe, it, expect } from "vitest";
import { reachableModels, unpricedModels } from "../../src/shared/utils/keyPricing.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

const combos = [
  { name: "Main", models: ["gemini/gemini-3.8-flash(medium)", "gemini/gemini-3.6-flash"] },
  { name: "Opus", models: ["cc/claude-opus-5-5", "gemini/no-such-model(medium)"] },
];
// resolve "provider/model" strings the way the engine does for explicit ids
const resolveModel = async (entry) => {
  const i = entry.indexOf("/");
  return i < 0 ? { provider: "anthropic", model: entry } : { provider: entry.slice(0, i), model: entry.slice(i + 1) };
};
const deps = {
  getCombos: async () => combos,
  resolveModel,
  getPricing: async (provider, model) => getPricingForModel(provider, model),
};

describe("reachableModels", () => {
  it("is unbounded (null) for an unrestricted key", async () => {
    expect(await reachableModels({ restricted: false, allow: [] }, deps)).toBeNull();
  });
  it("expands a combo (case-insensitive) into its members and keeps plain entries", async () => {
    const got = await reachableModels({ restricted: true, allow: ["main", "openai/gpt-4"] }, deps);
    expect(got.map((m) => `${m.provider}/${m.model}`)).toEqual([
      "gemini/gemini-3.8-flash(medium)", "gemini/gemini-3.6-flash", "openai/gpt-4",
    ]);
  });
  it("is empty for a restricted key with an empty allow list", async () => {
    expect(await reachableModels({ restricted: true, allow: [] }, deps)).toEqual([]);
  });
});

describe("unpricedModels", () => {
  it("an unrestricted key is ineligible and unbounded", async () => {
    expect(await unpricedModels({ restricted: false, allow: [] }, deps))
      .toEqual({ eligible: false, unbounded: true, unpriced: [] });
  });
  it("strips the thinking-level suffix before the price lookup, so flash(medium) is priced", async () => {
    const r = await unpricedModels({ restricted: true, allow: ["Main"] }, deps);
    expect(r).toEqual({ eligible: true, unbounded: false, unpriced: [] });
  });
  it("lists every unpriced member, with its suffix as written in the combo", async () => {
    const r = await unpricedModels({ restricted: true, allow: ["Opus"] }, deps);
    expect(r.eligible).toBe(false);
    expect(r.unpriced).toEqual(["gemini/no-such-model(medium)"]);
  });
  it("a restricted key that can call nothing is vacuously eligible", async () => {
    expect(await unpricedModels({ restricted: true, allow: [] }, deps))
      .toEqual({ eligible: true, unbounded: false, unpriced: [] });
  });
  it("treats a model the resolver cannot resolve as unpriced", async () => {
    const r = await unpricedModels({ restricted: true, allow: ["x"] }, { ...deps, resolveModel: async () => null });
    expect(r.unpriced).toEqual(["x"]);
  });
});
