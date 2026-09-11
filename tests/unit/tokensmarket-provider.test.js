import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { APIKEY_PROVIDERS } from "@/shared/constants/providers.js";

describe("Token Market provider", () => {
  const tokensmarket = REGISTRY.find((entry) => entry.id === "tokensmarket");

  it("registers an API-key OpenAI-compatible transport", () => {
    expect(tokensmarket).toBeDefined();
    expect(tokensmarket.category).toBe("apikey");
    expect(tokensmarket.authModes).toEqual(["apikey"]);
    expect(APIKEY_PROVIDERS.tokensmarket).toMatchObject({
      name: "Token Market",
      alias: "tokensmarket",
      authType: "apikey",
      passthroughModels: true,
    });
    expect(tokensmarket.transport).toMatchObject({
      baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
      validateUrl: "https://api.tokensmarket.ai/v1/models",
      thinkingFormat: "tokensmarket",
    });
  });

  it("seeds current models and allows new model ids through", () => {
    expect(tokensmarket.passthroughModels).toBe(true);
    expect(PROVIDER_MEDIA.tokensmarket.serviceKinds).toEqual(["llm"]);
    expect(PROVIDER_MODELS.tokensmarket.map((model) => model.id)).toEqual([
      "claude-fable-5",
      "gpt-5.6-sol",
      "gemini-3.5-flash",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
  });

  it("builds the derived runtime maps", () => {
    expect(PROVIDERS.tokensmarket).toMatchObject({
      baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
      validateUrl: "https://api.tokensmarket.ai/v1/models",
      format: "openai",
    });
    expect(PROVIDER_MODELS.tokensmarket).toHaveLength(5);
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
