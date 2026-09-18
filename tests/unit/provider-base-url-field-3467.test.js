import { describe, expect, it } from "vitest";

import { buildProviderSpecificData } from "../../src/shared/utils/providerSpecificData.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

/**
 * Self-hosted TTS/STT/embedding connections read their endpoint from
 * `providerSpecificData.baseUrl`, and their registry entries tell the user to
 * set it — but the dashboard rendered no field for it, so every connection
 * created through the UI was saved without one and fell back to a localhost
 * default. In Docker that default is the 9router container itself (#3467).
 *
 * The field is now declared in the registry and read from there, so a provider
 * that needs a per-connection endpoint cannot be added without one again.
 */
const entry = (id) => REGISTRY.find((r) => r.id === id);

describe("registry: providers with a per-connection endpoint declare it", () => {
  it.each([
    "selfhosted-tts",
    "selfhosted-stt",
    "selfhosted-embedding",
    "ollama-local",
  ])("%s declares a baseUrlField", (id) => {
    const field = entry(id)?.baseUrlField;
    expect(field, `${id} must declare baseUrlField`).toBeTruthy();
    expect(typeof field.label).toBe("string");
    expect(field.label.length).toBeGreaterThan(0);
    expect(typeof field.placeholder).toBe("string");
  });

  it("each placeholder matches the default that provider actually falls back to", () => {
    expect(entry("selfhosted-tts").baseUrlField.placeholder).toBe(
      entry("selfhosted-tts").ttsConfig.baseUrl,
    );
    expect(entry("selfhosted-stt").baseUrlField.placeholder).toBe(
      entry("selfhosted-stt").sttConfig.baseUrl,
    );
  });

  it("providers with a fixed endpoint do not declare one", () => {
    for (const id of ["openai", "anthropic", "gemini"]) {
      const e = entry(id);
      if (e) expect(e.baseUrlField, `${id}`).toBeUndefined();
    }
  });
});

describe("buildProviderSpecificData", () => {
  it("saves a trimmed baseUrl when the provider declares the field", () => {
    expect(
      buildProviderSpecificData({ hasBaseUrlField: true, baseUrl: "  http://tts:8880 " }),
    ).toEqual({ baseUrl: "http://tts:8880" });
  });

  it("saves nothing when the box is left empty, so the default still applies", () => {
    for (const value of ["", "   ", undefined, null]) {
      expect(buildProviderSpecificData({ hasBaseUrlField: true, baseUrl: value })).toBeUndefined();
    }
  });

  it("ignores a typed baseUrl for a provider that does not declare the field", () => {
    expect(
      buildProviderSpecificData({ hasBaseUrlField: false, baseUrl: "http://nope" }),
    ).toBeUndefined();
  });

  it("still builds the Azure shape", () => {
    expect(
      buildProviderSpecificData({
        isAzure: true,
        azureData: {
          azureEndpoint: "https://x.openai.azure.com",
          apiVersion: "2024-10-01-preview",
          deployment: "gpt-4o",
          organization: "org",
        },
      }),
    ).toEqual({
      azureEndpoint: "https://x.openai.azure.com",
      apiVersion: "2024-10-01-preview",
      deployment: "gpt-4o",
      organization: "org",
    });
  });

  it("still builds the Cloudflare and region shapes", () => {
    expect(
      buildProviderSpecificData({ isCloudflareAi: true, cloudflareData: { accountId: "acc" } }),
    ).toEqual({ accountId: "acc" });
    expect(buildProviderSpecificData({ hasRegions: true, region: "eu" })).toEqual({ region: "eu" });
    expect(buildProviderSpecificData({ hasRegions: true, region: "" })).toBeUndefined();
  });

  it("returns nothing for an ordinary provider", () => {
    expect(buildProviderSpecificData()).toBeUndefined();
    expect(buildProviderSpecificData({})).toBeUndefined();
  });
});
