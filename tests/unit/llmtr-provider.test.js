import { describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { parseModel } from "../../open-sse/services/model.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { routeLlmtrModel } from "../../src/lib/llmtrModels.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("LLMTR provider", () => {
  const entry = REGISTRY.find((e) => e.id === "llmtr");

  it("is an OpenAI-compatible api-key provider on the default executor", () => {
    expect(entry).toMatchObject({
      id: "llmtr",
      category: "apikey",
      authType: "apikey",
      alias: "llmtr",
      passthroughModels: true,
    });
    expect(entry.aliases).toContain("lt");
    expect(PROVIDERS.llmtr.baseUrl).toBe("https://llmtr.com/v1/chat/completions");
    expect(PROVIDERS.llmtr.format).toBe("openai");
    expect(PROVIDERS.llmtr.thinkingFormat).toBe("llmtr");
    expect(getExecutor("llmtr")).toBeInstanceOf(DefaultExecutor);
  });

  it("keeps a first-party llmtr/ id behind the provider segment", () => {
    expect(parseModel("llmtr/llmtr/qwen3-8-27b")).toMatchObject({
      provider: "llmtr",
      model: "llmtr/qwen3-8-27b",
    });
    expect(parseModel("lt/llmtr/qwen3-8-27b")).toMatchObject({
      provider: "llmtr",
      model: "llmtr/qwen3-8-27b",
    });
    expect(parseModel("llmtr/qwen/qwen3.8-27b-free")).toMatchObject({
      provider: "llmtr",
      model: "qwen/qwen3.8-27b-free",
    });
    const ids = (PROVIDER_MODELS.llmtr || []).map((m) => m.id);
    expect(ids).toEqual(["qwen/qwen3.8-27b-free", "llmtr/qwen3-8-27b"]);
  });

  it("sends reasoning as a boolean", () => {
    const on = { reasoning: { effort: "high", summary: "auto" }, reasoning_effort: "high" };
    applyThinking("openai", "llmtr/qwen3-8-27b", on, "llmtr");
    expect(on.reasoning).toBe(true);
    expect(on.reasoning_effort).toBeUndefined();

    const off = { reasoning_effort: "none" };
    applyThinking("openai", "qwen/qwen3.8-27b-free", off, "llmtr");
    expect(off.reasoning).toBe(false);

    const leftover = { reasoning: { enabled: true } };
    stripUnsupportedParams("llmtr", "qwen/qwen3.8-27b-free", leftover);
    expect(leftover.reasoning).toBe(true);
  });

  it("prefixes live catalog ids so the vendor segment stays on the model", () => {
    expect(routeLlmtrModel({ id: "qwen/qwen3.8-27b-free", name: "Qwen3.8 27B", supported_operations: ["CHAT_COMPLETIONS"] }))
      .toMatchObject({ id: "llmtr/qwen/qwen3.8-27b-free", upstreamModelId: "qwen/qwen3.8-27b-free" });
    expect(routeLlmtrModel({ id: "llmtr/qwen3-8-27b", supported_operations: ["CHAT_COMPLETIONS"] }))
      .toMatchObject({ id: "llmtr/llmtr/qwen3-8-27b", upstreamModelId: "llmtr/qwen3-8-27b" });
    expect(routeLlmtrModel({ id: "llmtr/embeddingmagibu-200m", supported_operations: ["EMBEDDINGS"] })).toBeNull();
    expect(routeLlmtrModel({ id: "llmtr/qwen/already-routed" }).id).toBe("llmtr/qwen/already-routed");
  });

  it("publishes first-party ids with the llmtr/ segment still attached", async () => {
    db.getProviderConnections.mockResolvedValue([{
      id: "conn-llmtr",
      provider: "llmtr",
      isActive: true,
      apiKey: "llmtr-test",
    }]);
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("lt/qwen/qwen3.8-27b-free");
    expect(ids).toContain("lt/llmtr/qwen3-8-27b");
    expect(ids).not.toContain("lt/qwen3-8-27b");
  });
});
