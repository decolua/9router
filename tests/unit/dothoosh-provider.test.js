import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

describe("DotHoosh provider", () => {
  const entry = REGISTRY.find((e) => e.id === "dothoosh");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("dothoosh");
    expect(entry.aliases).toContain("dh");
    expect(entry.display.name).toBe("DotHoosh");
    // Provider-facing strings are English like every other registry entry.
    expect(entry.display.notice.text).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("points at the verified OpenAI-compatible base URL", () => {
    expect(PROVIDERS.dothoosh.baseUrl).toBe("https://gateway.dothoosh.com/v1/chat/completions");
    expect(PROVIDERS.dothoosh.validateUrl).toBe("https://gateway.dothoosh.com/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.dothoosh.format).toBe("openai");
  });

  it("declares no provider-wide thinkingFormat so each model resolves its own", () => {
    // A provider-wide thinkingFormat would override capabilities.js and force
    // one wire format onto every model, which an OpenAI endpoint may reject.
    expect(PROVIDERS.dothoosh.thinkingFormat).toBeUndefined();
  });

  it("accepts passthrough ids and reads the public catalog live", () => {
    expect(entry.passthroughModels).toBe(true);
    // The public catalog answers without a key; keyless suggestions use the worldwide mirror
    // because the Iran-hosted API is unreachable from outside Iran. Keyed import stays on the API.
    expect(entry.modelsFetcher).toEqual([
      { url: "https://www.dothoosh.com/gateway/v1/models", type: "openai" },
      { url: "https://www.dothoosh.com/gateway/anthropic/v1/models", type: "anthropic" },
    ]);
  });

  it("hard-codes no model list: the live catalog is the only source", () => {
    expect(entry.models).toBeUndefined();
    expect(PROVIDER_MODELS.dothoosh).toBeUndefined();
  });

  it("maps the public catalog rows to suggestions with id, name and context", () => {
    const rows = [
      { id: "kimi-k3", name: "kimi-k3", context_length: 1048576, context_window: 1048576 },
      { id: "legacy", context_window: 8000 },
      { id: "no-limit" },
      { name: "no id" },
    ];
    expect(FILTERS.openai(rows)).toEqual([
      { id: "kimi-k3", name: "kimi-k3", contextLength: 1048576 },
      { id: "legacy", name: "legacy", contextLength: 8000 },
      { id: "no-limit", name: "no-limit" },
    ]);
    expect(FILTERS.openai([])).toEqual([]);
    expect(FILTERS.openai(undefined)).toEqual([]);
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("dothoosh")).toBeInstanceOf(DefaultExecutor);
  });

  it("resolves per-model capabilities from the shared tables", () => {
    // Bare ids must still reach the canonical family patterns.
    expect(getCapabilitiesForModel("dothoosh", "claude-opus-5-5")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
    });
    expect(getCapabilitiesForModel("dothoosh", "gpt-6.1-sol")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("does not invent capabilities for an uncatalogued model", () => {
    // Vision/reasoning must not be blanket-granted across the provider.
    const caps = getCapabilitiesForModel("dothoosh", "some-unknown-model-x");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
  });

  it("keeps every registry id unique after adding dothoosh", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves the Anthropic-compatible claude transport with x-api-key auth", () => {
    const transport = resolveTransport("dothoosh", "claude");
    expect(transport).toMatchObject({
      format: "claude",
      baseUrl: "https://gateway.dothoosh.com/anthropic/v1/messages",
      auth: { header: "x-api-key", scheme: "raw", anthropicVersion: true },
    });
  });

  it("resolves the OpenAI transport with bearer auth", () => {
    const transport = resolveTransport("dothoosh", "openai");
    expect(transport.baseUrl).toBe("https://gateway.dothoosh.com/v1/chat/completions");
    expect(transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("keeps uncatalogued ids on the lane their family is served on", () => {
    expect(getModelSupportedFormats("dothoosh", "claude-future-9")).toEqual(["claude"]);
    expect(getModelTargetFormat("dothoosh", "claude-future-9")).toBe("claude");
    expect(getModelSupportedFormats("dh", "claude-future-9")).toEqual(["claude"]);
    expect(getModelSupportedFormats("dothoosh", "claude-sonnet-5-5(high)")).toEqual(["claude"]);
    // An unknown non-Claude id must never be sent to the Anthropic-only lane.
    expect(getModelSupportedFormats("dothoosh", "brand-new-model")).toEqual(["openai"]);
    expect(getModelTargetFormat("dothoosh", "brand-new-model")).toBeFalsy();
  });

  it("declares the protocol lanes each model family is served on", () => {
    expect(getModelSupportedFormats("dothoosh", "claude-sonnet-5-5")).toEqual(["claude"]);
    expect(getModelSupportedFormats("dothoosh", "deepseek-flash")).toEqual(["openai", "claude"]);
    expect(getModelSupportedFormats("dothoosh", "gpt-6.1-sol")).toEqual(["openai", "openai-responses"]);
    expect(getModelSupportedFormats("dothoosh", "gemini-4-argon")).toEqual(["openai"]);
    expect(getModelSupportedFormats("dothoosh", "kimi-k3")).toEqual(["openai"]);
  });

  it("targets the claude wire format for Claude models only", () => {
    expect(getModelTargetFormat("dothoosh", "claude-opus-5-5")).toBe("claude");
    expect(getModelTargetFormat("dothoosh", "gpt-6.1-sol")).toBeFalsy();
  });

  it("resolves the OpenAI Responses transport with bearer auth", () => {
    const transport = resolveTransport("dothoosh", "openai-responses");
    expect(transport.baseUrl).toBe("https://gateway.dothoosh.com/v1/responses");
    expect(transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
  });

  it("sends only x-api-key and anthropic-version on the claude transport", () => {
    const headers = new DefaultExecutor("dothoosh").buildHeaders(
      { apiKey: "dh_test_x", runtimeTransport: resolveTransport("dothoosh", "claude") },
      true,
      undefined,
      "claude-sonnet-5-5",
      {},
    );
    expect(headers["x-api-key"]).toBe("dh_test_x");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("Anthropic-Beta");
    expect(headers).not.toHaveProperty("anthropic-beta");
  });
});

describe("DotHoosh in the alias baseline", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("../__baseline__/alias-baseline.json", import.meta.url), "utf8"),
  );

  it("lists no model key, because the catalog is live and PROVIDER_MODELS holds nothing for it", () => {
    expect(PROVIDER_MODELS.dothoosh).toBeUndefined();
    expect(baseline.modelKeys).not.toContain("dothoosh");
  });

  it("keeps the alias entries", () => {
    expect(baseline.aliasToId.dothoosh).toBe("dothoosh");
    expect(baseline.aliasToId.dh).toBe("dothoosh");
  });
});
