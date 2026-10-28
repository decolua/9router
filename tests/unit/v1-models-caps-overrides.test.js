import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  overrides: {},
  aliases: {},
  disabled: {},
  compatible: false
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => state.compatible ? [{
    id: "fixture-compatible",
    provider: "openai-compatible-fixture",
    isActive: true,
    providerSpecificData: {
      prefix: "fixture",
      enabledModels: ["qa-model"]
    }
  }] : [{
    id: "fixture",
    provider: "openai",
    isActive: true,
    providerSpecificData: {
      enabledModels: ["gpt-4o"]
    }
  }],
  getCombos: async () => [],
  getCustomModels: async () => [],
  getCapsOverrides: async () => state.overrides,
  getModelAliases: async () => state.aliases
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => state.disabled
}));
vi.mock("@/lib/db/index.js", () => ({
  getCapsOverrides: async () => state.overrides
}));
const {
  buildModelsList
} = await import("../../src/app/api/v1/models/route.js");
beforeEach(() => {
  state.overrides = {};
  state.aliases = {};
  state.disabled = {};
  state.compatible = false;
});
describe("persisted model metadata in /v1/models", () => {
  it("publishes provider overrides with client token-limit fields", async () => {
    state.overrides = {
      "openai|gpt-4o": {
        contextWindow: 90000,
        maxOutput: 1000,
        tools: false
      }
    };
    const models = await buildModelsList(["llm"]);
    expect(models.find(m => m.id === "openai/gpt-4o")).toMatchObject({
      context_length: 90000,
      max_completion_tokens: 1000,
      capabilities: {
        tools: false
      }
    });
  });
  it("copies visible target metadata to a friendly alias", async () => {
    state.aliases = {
      friendly: "openai/gpt-4o"
    };
    state.overrides = {
      "openai|gpt-4o": {
        contextWindow: 90000
      }
    };
    expect((await buildModelsList(["llm"])).find(m => m.id === "friendly")).toMatchObject({
      owned_by: "alias",
      context_length: 90000
    });
  });
  it("resolves compatible provider storage IDs through their routing prefix", async () => {
    state.compatible = true;
    state.overrides = {
      "openai-compatible-fixture|qa-model": {
        contextWindow: 72000
      }
    };
    state.aliases = {
      friendly: "openai-compatible-fixture/qa-model"
    };
    const models = await buildModelsList(["llm"]);
    expect(models.find(m => m.id === "fixture/qa-model")).toMatchObject({
      context_length: 72000
    });
    expect(models.find(m => m.id === "friendly")).toMatchObject({
      context_length: 72000
    });
  });
  it("does not resurrect disabled targets or publish LLM aliases as images", async () => {
    state.aliases = {
      hidden: "openai/gpt-4o"
    };
    state.disabled = {
      openai: ["gpt-4o"]
    };
    expect((await buildModelsList(["llm"])).some(m => m.id === "hidden")).toBe(false);
    state.disabled = {};
    expect((await buildModelsList(["image"])).some(m => m.id === "hidden")).toBe(false);
  });
});
