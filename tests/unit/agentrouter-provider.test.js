import { describe, expect, it } from "vitest";

import {
  getDefaultModel,
  getModelsByProviderId,
  PROVIDER_MODELS,
} from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("AgentRouter provider", () => {
  const entry = REGISTRY.find((provider) => provider.id === "agentrouter");

  it("is exposed as a free-tier API-key provider", () => {
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("agr");
    expect(entry.category).toBe("freeTier");
    expect(entry.passthroughModels).toBe(true);
    expect(FREE_TIER_PROVIDERS.agentrouter).toBeDefined();
    expect(AI_PROVIDERS.agentrouter.name).toBe("AgentRouter");
    expect(AI_PROVIDERS.agentrouter.alias).toBe("agr");
  });

  it("routes models through the agr/ prefix while retaining the provider ID", () => {
    expect(resolveProviderAlias("agr")).toBe("agentrouter");
    expect(resolveProviderAlias("agentrouter")).toBe("agentrouter");
    expect(parseModel("agr/claude-opus-4-8")).toEqual({
      provider: "agentrouter",
      model: "claude-opus-4-8",
      isAlias: false,
      providerAlias: "agr",
    });
  });

  it("uses the Claude Code wire image by default", () => {
    const config = PROVIDERS.agentrouter;
    expect(config.baseUrl).toBe("https://agentrouter.org/v1/messages");
    expect(config.urlSuffix).toBe("?beta=true");
    expect(config.format).toBe("claude");
    expect(config.auth).toEqual({ combined: true, header: "x-api-key", scheme: "raw" });
    expect(config.headers["User-Agent"]).toMatch(/^claude-cli\//);
    expect(config.headers["X-App"]).toBe("cli");
  });

  it("declares Claude, OpenAI Chat, and OpenAI Responses transports", () => {
    expect(PROVIDERS.agentrouter.transports.map((transport) => transport.format)).toEqual([
      "openai",
      "claude",
      "openai-responses",
    ]);
    expect(resolveTransport("agentrouter", "openai").baseUrl).toBe(
      "https://agentrouter.org/v1/chat/completions",
    );
    expect(resolveTransport("agentrouter", "claude").baseUrl).toBe(
      "https://agentrouter.org/v1/messages",
    );
    expect(resolveTransport("agentrouter", "openai-responses").baseUrl).toBe(
      "https://agentrouter.org/v1/responses",
    );
  });

  it("applies protocol-specific authentication and identity headers", () => {
    const executor = new DefaultExecutor("agentrouter");
    const credentials = { apiKey: "agentrouter-test-key" };

    const claudeTransport = resolveTransport("agentrouter", "claude");
    const claudeCredentials = { ...credentials, runtimeTransport: claudeTransport };
    expect(executor.buildUrl("claude-opus-4-8", false, 0, claudeCredentials)).toBe(
      "https://agentrouter.org/v1/messages?beta=true",
    );
    const claudeHeaders = executor.buildHeaders(claudeCredentials, false);
    expect(claudeHeaders["x-api-key"]).toBe("agentrouter-test-key");
    expect(claudeHeaders.Authorization).toBeUndefined();
    expect(claudeHeaders["User-Agent"]).toMatch(/^claude-cli\//);

    const responsesTransport = resolveTransport("agentrouter", "openai-responses");
    const responsesCredentials = { ...credentials, runtimeTransport: responsesTransport };
    expect(executor.buildUrl("gpt-5.6-sol", false, 0, responsesCredentials)).toBe(
      "https://agentrouter.org/v1/responses",
    );
    const responsesHeaders = executor.buildHeaders(responsesCredentials, false);
    expect(responsesHeaders.Authorization).toBe("Bearer agentrouter-test-key");
    expect(responsesHeaders["x-api-key"]).toBeUndefined();
    expect(responsesHeaders.originator).toBe("codex_cli_rs");
  });

  it("seeds the current OmniRoute model catalog while allowing passthrough IDs", () => {
    expect(PROVIDER_MODELS.agr.map((model) => model.id)).toEqual([
      "claude-opus-4-8",
      "claude-opus-5",
      "gpt-5.6-sol",
    ]);
    expect(getDefaultModel("agr")).toBe("claude-opus-4-8");
    expect(getModelsByProviderId("agentrouter")).toBe(PROVIDER_MODELS.agr);
  });
});
