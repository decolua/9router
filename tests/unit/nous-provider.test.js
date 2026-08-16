import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import {
  PROVIDERS,
  PROVIDER_MODELS,
  PROVIDER_OAUTH,
} from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import {
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_MODELS_URL,
  NOUS_VALIDATION_MODEL,
  createNousApiKeyProbe,
  getNousApiKeyValidationError,
  isNousApiKeyAccepted,
  normalizeNousFreeModels,
  normalizeNousModels,
} from "../../open-sse/services/nous.js";

describe("Nous Research provider", () => {
  const entry = REGISTRY.find((candidate) => candidate.id === "nous");
  const hermes70b = "nousresearch/hermes-4-70b";

  it("is registered with API-key-only authentication", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("freeTier");
    expect(entry.hasFree).toBe(true);
    expect(entry.authType).toBe("apikey");
    expect(entry.authModes).toEqual(["apikey"]);
    expect(entry.display.name).toBe("Nous Research");
    expect(entry.display.notice.apiKeyUrl).toBe("https://portal.nousresearch.com/api-keys");
    expect(PROVIDER_OAUTH.nous).toBeUndefined();
  });

  it("uses the documented OpenAI-compatible inference endpoint", () => {
    expect(PROVIDERS.nous).toBeDefined();
    expect(PROVIDERS.nous.format).toBe("openai");
    expect(PROVIDERS.nous.baseUrl).toBe(NOUS_CHAT_COMPLETIONS_URL);
    expect(NOUS_MODELS_URL).toBe("https://inference-api.nousresearch.com/v1/models");
  });

  it("seeds both current Hermes 4 models with their advertised context", () => {
    const expectedIds = [
      "nousresearch/hermes-4-70b",
      "nousresearch/hermes-4-405b",
    ];
    const models = PROVIDER_MODELS.nous || [];

    expect(models.map((model) => model.id)).toEqual(expectedIds);
    expect(models.every((model) => model.contextLength === 131072)).toBe(true);
    expect(getModelsByProviderId("nous").map((model) => model.id)).toEqual(expectedIds);
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toEqual({
      url: NOUS_MODELS_URL,
      type: "nous-free",
    });
  });

  it("resolves the provider's public names without alias collisions", () => {
    for (const alias of ["nous", "nous-portal", "nous-research"]) {
      expect(resolveProviderAlias(alias)).toBe("nous");
    }
    expect(resolveProviderAlias("nousresearch")).toBe("nousresearch");
    expect(parseModel("nousresearch/hermes-4-70b")).toMatchObject({
      provider: "nousresearch",
      model: "hermes-4-70b",
    });
    expect(parseModel("nous/nousresearch/hermes-4-70b")).toMatchObject({
      provider: "nous",
      model: "nousresearch/hermes-4-70b",
    });

    const ids = REGISTRY.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks Hermes 4 conservatively until tool calling is advertised", () => {
    for (const model of PROVIDER_MODELS.nous) {
      const capabilities = getCapabilitiesForModel("nous", model.id);
      expect(capabilities).toMatchObject({
        tools: false,
        reasoning: true,
        thinkingFormat: "nous",
        contextWindow: 131072,
        maxOutput: 32000,
      });
    }
  });

  it("maps reasoning controls to Nous's nested wire format", () => {
    const enabled = {
      model: hermes70b,
      messages: [{ role: "user", content: "reason about this" }],
      reasoning_effort: "high",
    };
    applyThinking("openai", hermes70b, enabled, "nous");
    expect(enabled.reasoning_effort).toBeUndefined();
    expect(enabled.reasoning).toEqual({ enabled: true, effort: "high" });

    const disabled = {
      model: hermes70b,
      messages: [{ role: "user", content: "answer directly" }],
      reasoning_effort: "none",
    };
    applyThinking("openai", hermes70b, disabled, "nous");
    expect(disabled.reasoning_effort).toBeUndefined();
    expect(disabled.reasoning).toBeUndefined();
  });

  it("builds a minimal authenticated chat probe instead of trusting public models", () => {
    const probe = createNousApiKeyProbe("test-api-key");
    const body = JSON.parse(probe.options.body);

    expect(probe.url).toBe(NOUS_CHAT_COMPLETIONS_URL);
    expect(probe.url).not.toBe(NOUS_MODELS_URL);
    expect(probe.options.method).toBe("POST");
    expect(probe.options.headers.Authorization).toBe("Bearer test-api-key");
    expect(body).toEqual({
      model: NOUS_VALIDATION_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    });
    expect(NOUS_VALIDATION_MODEL).toMatch(/:free$/);
  });

  it("accepts only successful inference as proof of authentication", () => {
    expect(isNousApiKeyAccepted(200)).toBe(true);
    expect(isNousApiKeyAccepted(204)).toBe(true);
    expect(isNousApiKeyAccepted(400)).toBe(false);
    expect(isNousApiKeyAccepted(401)).toBe(false);
    expect(isNousApiKeyAccepted(402)).toBe(false);
    expect(isNousApiKeyAccepted(403)).toBe(false);
    expect(isNousApiKeyAccepted(404)).toBe(false);
    expect(isNousApiKeyAccepted(429)).toBe(false);
    expect(isNousApiKeyAccepted(500)).toBe(false);
    expect(getNousApiKeyValidationError(401)).toBe("Invalid or inactive API key");
    expect(getNousApiKeyValidationError(503)).toBe(
      "Unable to verify API key (Nous returned 503)",
    );
  });

  it("normalizes the live catalogue and removes non-chat models", () => {
    const models = normalizeNousModels({
      data: [
        {
          id: "vendor/text-model",
          name: "Vendor Text Model",
          context_length: 262144,
          top_provider: { max_completion_tokens: 65536 },
          architecture: { output_modalities: ["text"] },
        },
        {
          id: "vendor/embedding-model",
          architecture: { output_modalities: ["embeddings"] },
        },
        {
          id: "nousresearch/hermes-4-70b",
          name: "Nous: Hermes 4 70B",
          description: "Hybrid reasoning model",
          context_length: 131072,
          architecture: { output_modalities: ["text"] },
        },
        { id: "  " },
      ],
    });

    expect(models).toEqual([
      {
        id: "nousresearch/hermes-4-70b",
        name: "Nous: Hermes 4 70B",
        contextLength: 131072,
        description: "Hybrid reasoning model",
      },
      {
        id: "vendor/text-model",
        name: "Vendor Text Model",
        contextLength: 262144,
        maxOutputTokens: 65536,
      },
    ]);
  });

  it("suggests only zero-cost text models with at least 200K context", () => {
    const models = normalizeNousFreeModels([
      {
        id: "vendor/free-chat",
        name: "Free Chat",
        context_length: 262144,
        pricing: { prompt: "0", completion: "0.0000000000" },
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "vendor/paid-chat",
        context_length: 262144,
        pricing: { prompt: "0.0000001", completion: "0" },
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "vendor/free-short-chat",
        context_length: 131072,
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "vendor/free-embedding",
        context_length: 262144,
        pricing: { prompt: "0", completion: "0" },
        architecture: { output_modalities: ["embeddings"] },
      },
    ]);

    expect(models).toEqual([{
      id: "vendor/free-chat",
      name: "Free Chat",
      contextLength: 262144,
    }]);
  });
});
