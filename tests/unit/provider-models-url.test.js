import { describe, expect, it } from "vitest";
import { normalizeModelsUrl } from "../../src/lib/providerModelsUrl.js";
import { getProviderModelSettings, normalizeProviderModelSettings } from "../../src/lib/providerModelSettings.js";

describe("provider models URL normalization", () => {
  it("keeps a full HTTPS models endpoint instead of deriving it from the base URL", () => {
    expect(normalizeModelsUrl(" https://example.com/catalog/available-models ")).toBe(
      "https://example.com/catalog/available-models",
    );
  });

  it("allows clearing an override so the provider default is used", () => {
    expect(normalizeModelsUrl("  ")).toBe("");
  });

  it("rejects unsupported URL protocols", () => {
    expect(() => normalizeModelsUrl("file:///tmp/models.json")).toThrow("http or https");
  });

  it("normalizes shared provider model settings", () => {
    expect(normalizeProviderModelSettings({
      deepseek: {
        modelsUrl: " https://example.com/custom/models ",
        testModel: " deepseek-chat ",
      },
    })).toEqual({
      deepseek: {
        modelsUrl: "https://example.com/custom/models",
        testModel: "deepseek-chat",
      },
    });
  });

  it("prefers provider settings and allows them to clear legacy connection values", () => {
    expect(getProviderModelSettings({
      providerModelSettings: { deepseek: { modelsUrl: "", testModel: "deepseek-reasoner" } },
    }, "deepseek", {
      modelsUrl: "https://legacy.example.com/models",
      testModel: "deepseek-chat",
    })).toEqual({
      modelsUrl: "",
      testModel: "deepseek-reasoner",
    });
  });
});
