import { describe, it, expect } from "vitest";
import { deriveModelsUrl, fetchProviderLiveModels } from "@/shared/utils/providerLiveModels";

describe("generic live models util", () => {
  it("derives nvidia /models url from validateUrl", () => {
    expect(deriveModelsUrl("nvidia")).toBe("https://integrate.api.nvidia.com/v1/models");
  });
  it("derives openrouter url from modelsFetcher", () => {
    expect(deriveModelsUrl("openrouter")).toBe("https://openrouter.ai/api/v1/models");
  });
  it("derives groq url from baseUrl", () => {
    expect(deriveModelsUrl("groq")).toBe("https://api.groq.com/openai/v1/models");
  });
  it("returns null for unknown provider", () => {
    expect(deriveModelsUrl("no-such-provider")).toBeNull();
  });
});