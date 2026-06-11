import { describe, it, expect } from "vitest";
import { APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getDefaultModel, getProviderModels } from "../../open-sse/config/providerModels.js";

describe("qiniu provider", () => {
  it("is registered in API key providers with stable id/alias", () => {
    const provider = APIKEY_PROVIDERS.qiniu;

    expect(provider).toBeDefined();
    expect(provider.id).toBe("qiniu");
    expect(provider.alias).toBe("qiniu");
    expect(provider.serviceKinds).toEqual(["llm"]);
  });

  it("uses qiniu chat-completions endpoint with openai format", () => {
    const providerConfig = PROVIDERS.qiniu;

    expect(providerConfig).toBeDefined();
    expect(providerConfig.baseUrl).toBe("https://api.qnaigc.com/v1/chat/completions");
    expect(providerConfig.format).toBe("openai");
  });

  it("keeps deepseek-v3 as fallback/default model", () => {
    const models = getProviderModels("qiniu");

    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBe("deepseek-v3");
    expect(getDefaultModel("qiniu")).toBe("deepseek-v3");
  });
});
