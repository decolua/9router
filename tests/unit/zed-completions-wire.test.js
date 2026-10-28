// Zed completions wire acceptance: the `provider` field of POST /completions
// must use cloud.zed.dev's exact wire values (anthropic/open_ai/google/x_ai),
// and the Zed Gemini path must not carry the shared translator's
// safetySettings (Zed's hosted Gemini backend speaks the Vertex safety
// vocabulary, not the public-Gemini enums).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("open-sse/shared/zedAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveZedModels: vi.fn(),
    zedLlmFetch: vi.fn(),
  };
});

import {
  resolveZedModels,
  zedLlmFetch,
} from "open-sse/shared/zedAuth.js";
import ZedExecutor from "open-sse/executors/zed.js";

function catalogFor(entries) {
  const rawById = new Map(entries);
  return { rawById, models: [] };
}

function mockCatalogFetch(captured) {
  zedLlmFetch.mockImplementation(async (credentials, path, options) => {
    captured.body = JSON.parse(options.fetchOptions.body);
    return new Response("upstream-error-stub", { status: 500 });
  });
}

function makeExecutor() {
  const executor = new ZedExecutor();
  executor.config = {};
  return executor;
}

const CHAT_BODY = { messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wire provider enum", () => {
  it.each([
    ["Anthropic", "anthropic"],
    ["anthropic", "anthropic"],
    ["OpenAi", "open_ai"],
    ["open_ai", "open_ai"],
    ["Google", "google"],
    ["gemini", "google"],
    ["XAi", "x_ai"],
    ["x_ai", "x_ai"],
  ])("catalog provider %j normalizes to wire %j", async (catalogValue, wire) => {
    resolveZedModels.mockResolvedValue(catalogFor([["m", { provider: catalogValue }]]));
    const executor = makeExecutor();
    const { provider } = await executor.resolveModel("m", {}, null, null);
    expect(provider).toBe(wire);
  });

  it("infers wire provider from the model id when the catalog is unavailable", async () => {
    resolveZedModels.mockRejectedValue(new Error("catalog down"));
    const executor = makeExecutor();
    const log = { warn: vi.fn() };
    expect((await executor.resolveModel("claude-opus-x", {}, null, log)).provider).toBe("anthropic");
    expect((await executor.resolveModel("gemini-3-x", {}, null, log)).provider).toBe("google");
    expect((await executor.resolveModel("grok-4-x", {}, null, log)).provider).toBe("x_ai");
    expect((await executor.resolveModel("gpt-5-x", {}, null, log)).provider).toBe("open_ai");
  });
});

describe("completion payload shaping", () => {
  it("sends wire provider values per model family", async () => {
    resolveZedModels.mockImplementation(async () => catalogFor([
      ["claude-x", { provider: "anthropic" }],
      ["gpt-x", { provider: "open_ai" }],
      ["gemini-x", { provider: "google" }],
      ["grok-x", { provider: "x_ai" }],
    ]));
    const captured = {};
    mockCatalogFetch(captured);
    const executor = makeExecutor();

    for (const [model, wire] of [
      ["claude-x", "anthropic"],
      ["gpt-x", "open_ai"],
      ["gemini-x", "google"],
      ["grok-x", "x_ai"],
    ]) {
      await executor.execute({ model, body: { ...CHAT_BODY }, stream: false, credentials: {} });
      expect(captured.body.provider).toBe(wire);
      expect(captured.body.model).toBe(model);
    }
  });

  it("strips safetySettings on the Zed Gemini path only", async () => {
    resolveZedModels.mockImplementation(async () => catalogFor([
      ["gemini-x", { provider: "google" }],
      ["claude-x", { provider: "anthropic" }],
    ]));
    const captured = {};
    mockCatalogFetch(captured);
    const executor = makeExecutor();

    await executor.execute({ model: "gemini-x", body: { ...CHAT_BODY }, stream: false, credentials: {} });
    expect(captured.body.provider).toBe("google");
    expect(captured.body.provider_request).not.toHaveProperty("safetySettings");

    // Sanity: the shared translator still emits safetySettings — the removal
    // happens in the Zed executor, not in shared/native Gemini behavior.
    const { openaiToGeminiRequest } = await import(
      "open-sse/translator/request/openai-to-gemini.js"
    );
    expect(openaiToGeminiRequest("gemini-x", { ...CHAT_BODY }, true)).toHaveProperty(
      "safetySettings",
    );
  });
});
