import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

const CHAT_MODELS = [
  "glm-5.2",
  "glm-5.1",
  // OpenCode Go docs' endpoint table currently says kimi-k2.7, but its
  // config example and the live API use kimi-k2.7-code.
  "kimi-k2.7-code",
  "kimi-k2.6",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "mimo-v2.5",
  "mimo-v2.5-pro",
];

const MESSAGES_MODELS = [
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
];

describe("OpenCode Go official model catalog", () => {
  it("matches the documented OpenCode Go model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((model) => model.id);

    expect(ids).toEqual([...CHAT_MODELS, ...MESSAGES_MODELS]);
  });

  it("marks documented Qwen and MiniMax models as Anthropic messages format", () => {
    for (const model of MESSAGES_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBe("claude");
    }
  });

  it("keeps GLM, Kimi, DeepSeek, and MiMo on OpenAI-compatible chat format", () => {
    for (const model of CHAT_MODELS) {
      expect(getModelTargetFormat("opencode-go", model)).toBeNull();
    }
  });
});

describe("OpenCode Go endpoint routing", () => {
  it("routes Qwen and MiniMax models to the messages endpoint with x-api-key auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of MESSAGES_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/messages");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers["x-api-key"]).toBe("sk-test");
      expect(headers["anthropic-version"]).toBeDefined();
      expect(headers.Authorization).toBeUndefined();
    }
  });

  it("routes GLM, Kimi, DeepSeek, and MiMo models to chat/completions with bearer auth", () => {
    const executor = new OpenCodeGoExecutor();

    for (const model of CHAT_MODELS) {
      expect(executor.buildUrl(model)).toBe("https://opencode.ai/zen/go/v1/chat/completions");
      const headers = executor.buildHeaders({ apiKey: "sk-test" }, false);
      expect(headers.Authorization).toBe("Bearer sk-test");
      expect(headers["x-api-key"]).toBeUndefined();
      expect(headers["anthropic-version"]).toBeUndefined();
    }
  });
});
