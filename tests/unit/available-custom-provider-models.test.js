import { describe, expect, it } from "vitest";
import { createCustomProviderModelEntry, filterModelsByAllowedModels } from "@/lib/usage/availableModels.js";

describe("custom provider models in Available Models", () => {
  const provider = "openai-compatible-chat-live-test";
  const model = { id: "wz/gpt-5.6-luna", name: "GPT 5.6 Luna" };

  it("uses a unique node prefix as the live model route ID", () => {
    const entry = createCustomProviderModelEntry({
      provider,
      model,
      providerNode: { id: provider, prefix: "openai-acme" },
    });

    expect(entry).toMatchObject({
      provider,
      model: "wz/gpt-5.6-luna",
      fullModel: `${provider}/wz/gpt-5.6-luna`,
      routedModel: "openai-acme/wz/gpt-5.6-luna",
      origin: "custom",
    });
    expect(filterModelsByAllowedModels([entry], "openai-acme/wz/gpt-5.6-luna")).toEqual([entry]);
  });

  it("preserves saved custom model names and prefix-keyed aliases", () => {
    const entry = createCustomProviderModelEntry({
      provider,
      model: { ...model, name: "Saved display name", providerAlias: "openai-acme" },
      providerNode: { id: provider, prefix: "openai-acme" },
      aliases: { "openai-acme/wz/gpt-5.6-luna": "saved-alias" },
    });

    expect(entry.name).toBe("Saved display name");
    expect(entry.alias).toBe("saved-alias");
  });

  it("does not list a live custom model outside the key allowlist", () => {
    const entry = createCustomProviderModelEntry({
      provider,
      model,
      providerNode: { id: provider, prefix: "openai-acme" },
    });

    expect(filterModelsByAllowedModels([entry], "openai-acme/wz/gpt-5.6-other")).toEqual([]);
  });

  it("does not claim a reserved built-in prefix routes to the custom node", () => {
    const entry = createCustomProviderModelEntry({
      provider,
      model,
      providerNode: { id: provider, prefix: "openai" },
    });

    expect(entry.routedModel).toBe(`${provider}/wz/gpt-5.6-luna`);
    expect(filterModelsByAllowedModels([entry], "openai/wz/gpt-5.6-luna")).toEqual([]);
  });
});
