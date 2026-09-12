import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { augmentModelsWithCapacityAdapter, getCapacityAdapterModels } from "../../open-sse/services/capacityAdapter.js";
import deepseek from "../../open-sse/providers/registry/deepseek.js";

// DeepSeek renamed its flash model on 2026-09-10: `deepseek-flash` is the
// canonical id for V4.1 Flash, and `deepseek-v4-flash` /
// `deepseek-v4-flash-vision-exp` are retired ids that DeepSeek still routes to
// the same model for compatibility. All three accept image input.
const V41_FLASH_IDS = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];

const TEXT_ONLY_MODEL = "oc/text-only-model";
const BOTH_POOLS_ENABLED_EMPTY = {
  capacityAdapter: {
    vision: { enabled: true, models: [] },
    audioInput: { enabled: true, models: [] },
  },
};

describe("DeepSeek V4.1 Flash capabilities", () => {
  for (const id of V41_FLASH_IDS) {
    it(`${id} is reported as vision-capable with the full 1M window`, () => {
      const caps = getCapabilitiesForModel("deepseek", id);
      expect(caps.vision).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.maxOutput).toBe(384000);
    });
  }

  it("exposes the canonical id in the registry and points the retired ids at it", () => {
    const byId = Object.fromEntries(deepseek.models.map((m) => [m.id, m]));
    expect(Object.keys(byId)).toContain("deepseek-flash");
    expect(byId["deepseek-v4-flash"].upstreamModelId).toBe("deepseek-flash");
    expect(byId["deepseek-v4-flash-vision-exp"].upstreamModelId).toBe("deepseek-flash");
  });
});

describe("capacity adapter pooling", () => {
  it("leaves a model list alone when the requested model already covers the capability", () => {
    const models = ["ds/deepseek-v4-flash"];
    expect(augmentModelsWithCapacityAdapter(models, ["vision"], BOTH_POOLS_ENABLED_EMPTY)).toEqual(models);
  });

  it("prepends a capable pool model when no requested model covers the capability", () => {
    const settings = { capacityAdapter: { vision: { enabled: true, models: ["ds/deepseek-v4-flash-vision-exp"] } } };
    const out = augmentModelsWithCapacityAdapter([TEXT_ONLY_MODEL], ["vision"], settings);
    expect(out[0]).toBe("ds/deepseek-v4-flash-vision-exp");
    expect(out).toContain(TEXT_ONLY_MODEL);
  });

  it("only pools models for the capabilities the request needs", () => {
    const onlyAudioEnabled = { capacityAdapter: { audioInput: { enabled: true, models: [] } } };
    // Every pool (unchanged behaviour for callers that pass no capabilities).
    expect(getCapacityAdapterModels(onlyAudioEnabled)).toEqual(["oc/mimo-v2.5-free"]);
    // A vision request must not pick up an audio pool's models.
    expect(getCapacityAdapterModels(onlyAudioEnabled, ["vision"])).toEqual([]);
    expect(augmentModelsWithCapacityAdapter([TEXT_ONLY_MODEL], ["vision"], onlyAudioEnabled)).toEqual([TEXT_ONLY_MODEL]);
  });

  it("selects the pool belonging to the requested capability", () => {
    const settings = {
      capacityAdapter: {
        vision: { enabled: true, models: ["ds/vision-pool-model"] },
        pdf: { enabled: true, models: ["oc/pdf-pool-model"] },
      },
    };
    expect(getCapacityAdapterModels(settings, ["vision"])).toEqual(["ds/vision-pool-model"]);
    expect(getCapacityAdapterModels(settings, ["pdf"])).toEqual(["oc/pdf-pool-model"]);
    expect(getCapacityAdapterModels(settings)).toEqual(["ds/vision-pool-model", "oc/pdf-pool-model"]);
  });
});
