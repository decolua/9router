import { afterEach, describe, expect, it, vi } from "vitest";

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
import { refreshNousToken } from "../../open-sse/services/tokenRefresh.js";
import nousOAuth from "../../src/lib/oauth/providers/nous.js";
import {
  NOUS_AGENT_KEY_URL,
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_DEVICE_CODE_URL,
  NOUS_MODELS_URL,
  NOUS_OAUTH_CLIENT_ID,
  NOUS_OAUTH_SCOPE,
  NOUS_TOKEN_URL,
  NOUS_VALIDATION_MODEL,
  createNousApiKeyProbe,
  getNousApiKeyValidationError,
  isNousApiKeyAccepted,
  normalizeNousFreeModels,
  normalizeNousModels,
} from "../../open-sse/services/nous.js";

const originalFetch = global.fetch;

describe("Nous Research provider", () => {
  const entry = REGISTRY.find((candidate) => candidate.id === "nous");
  const sampleFreeModel = "poolside/laguna-s-2.1:free";

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("is registered with dual OAuth (Device Code) + API-key authentication in freeTier", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("freeTier");
    expect(entry.hasFree).toBe(true);
    expect(entry.hasOAuth).toBe(true);
    expect(entry.authType).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth", "apikey"]);
    expect(entry.display.name).toBe("Nous Research");
    expect(entry.display.notice.apiKeyUrl).toBe("https://portal.nousresearch.com/api-keys");
    expect(PROVIDER_OAUTH.nous).toMatchObject({
      clientId: NOUS_OAUTH_CLIENT_ID,
      scope: NOUS_OAUTH_SCOPE,
      deviceCodeUrl: NOUS_DEVICE_CODE_URL,
      tokenUrl: NOUS_TOKEN_URL,
      agentKeyUrl: NOUS_AGENT_KEY_URL,
    });
  });

  it("uses the documented OpenAI-compatible inference endpoint", () => {
    expect(PROVIDERS.nous).toBeDefined();
    expect(PROVIDERS.nous.format).toBe("openai");
    expect(PROVIDERS.nous.baseUrl).toBe(NOUS_CHAT_COMPLETIONS_URL);
    expect(NOUS_MODELS_URL).toBe("https://inference-api.nousresearch.com/v1/models");
  });

  it("seeds the 8 current live free-tier models with advertised context", () => {
    const expectedIds = [
      "meituan/longcat-2.0:free",
      "meituan/longcat-2.5-preview:free",
      "stepfun/step-5-preview:free",
      "upstage/solar-mini4:free",
      "stepfun/step-3.7-flash:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
      "stealth/missingno",
    ];
    const models = PROVIDER_MODELS.nous || [];

    expect(models.map((model) => model.id)).toEqual(expectedIds);
    expect(models.every((model) => model.contextLength >= 262144)).toBe(true);
    expect(getModelsByProviderId("nous").map((model) => model.id)).toEqual(expectedIds);
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toEqual({
      url: NOUS_MODELS_URL,
      type: "nous-free",
    });
  });

  it("resolves the provider's public names without alias collisions", () => {
    for (const alias of ["nous", "nous-portal", "nous-research", "ns"]) {
      expect(resolveProviderAlias(alias)).toBe("nous");
    }
    expect(resolveProviderAlias("nousresearch")).toBe("nousresearch");
    expect(parseModel("nous/poolside/laguna-s-2.1:free")).toMatchObject({
      provider: "nous",
      model: "poolside/laguna-s-2.1:free",
    });

    const ids = REGISTRY.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("advertises tool calling and reasoning capabilities for seeded Nous models", () => {
    for (const model of PROVIDER_MODELS.nous) {
      const capabilities = getCapabilitiesForModel("nous", model.id);
      expect(capabilities).toMatchObject({
        tools: true,
        reasoning: true,
        thinkingFormat: "nous",
      });
      expect(capabilities.contextWindow).toBeGreaterThanOrEqual(262144);
    }
  });

  it("maps reasoning controls to Nous's nested wire format", () => {
    const enabled = {
      model: sampleFreeModel,
      messages: [{ role: "user", content: "reason about this" }],
      reasoning_effort: "high",
    };
    applyThinking("openai", sampleFreeModel, enabled, "nous");
    expect(enabled.reasoning_effort).toBeUndefined();
    expect(enabled.reasoning).toEqual({ enabled: true, effort: "high" });

    const disabled = {
      model: sampleFreeModel,
      messages: [{ role: "user", content: "answer directly" }],
      reasoning_effort: "none",
    };
    applyThinking("openai", sampleFreeModel, disabled, "nous");
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
          id: "nousresearch/first-party-model",
          name: "Nous First Party",
          description: "Hybrid reasoning model",
          context_length: 262144,
          architecture: { output_modalities: ["text"] },
        },
        { id: "  " },
      ],
    });

    expect(models).toEqual([
      {
        id: "nousresearch/first-party-model",
        name: "Nous First Party",
        contextLength: 262144,
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

  it("supports OAuth Device Code exchange and agent-key minting with fallback", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: "dev_123",
        user_code: "NOUS-1234",
        verification_uri: "https://portal.nousresearch.com/device",
        verification_uri_complete: "https://portal.nousresearch.com/device?user_code=NOUS-1234",
        expires_in: 900,
        interval: 5,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        api_key: "sk-nous-agent-minted",
        key_id: "key_abc",
        expires_at: "2026-10-15T00:00:00Z",
        expires_in: 7200,
      }), { status: 200 }));

    const device = await nousOAuth.requestDeviceCode(nousOAuth.config);
    expect(device.user_code).toBe("NOUS-1234");

    const extra = await nousOAuth.postExchange({ access_token: "at_raw" });
    expect(extra.agentKey).toBe("sk-nous-agent-minted");

    const mapped = nousOAuth.mapTokens({
      access_token: "at_raw",
      refresh_token: "rt_raw",
      expires_in: 3600,
      scope: NOUS_OAUTH_SCOPE,
    }, extra);
    expect(mapped.apiKey).toBe("sk-nous-agent-minted");
    expect(mapped.accessToken).toBe("at_raw");
    expect(mapped.refreshToken).toBe("rt_raw");
    expect(mapped.providerSpecificData.agentKeyId).toBe("key_abc");

    const fallbackMapped = nousOAuth.mapTokens({
      access_token: "at_raw",
      refresh_token: "rt_raw",
      expires_in: 3600,
    }, { agentKey: null });
    expect(fallbackMapped.apiKey).toBe("at_raw");
  });

  it("refreshes Nous OAuth token and mints a fresh agent key", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "at_refreshed",
        refresh_token: "rt_refreshed",
        expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        api_key: "sk-nous-agent-refreshed",
        key_id: "key_refreshed",
        expires_at: "2026-10-15T02:00:00Z",
      }), { status: 200 }));

    const refreshed = await refreshNousToken("rt_initial");
    expect(refreshed).toMatchObject({
      accessToken: "at_refreshed",
      refreshToken: "rt_refreshed",
      expiresIn: 3600,
      apiKey: "sk-nous-agent-refreshed",
      agentKey: "sk-nous-agent-refreshed",
      providerSpecificData: {
        agentKeyId: "key_refreshed",
        agentKeyExpiresAt: "2026-10-15T02:00:00Z",
      },
    });
  });
});
