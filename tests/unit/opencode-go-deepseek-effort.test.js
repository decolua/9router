import { describe, it, expect } from "vitest";
import { THINKING_CONFIG, AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

describe("opencode-go model catalog", () => {
  const ids = getProviderModels("opencode-go").map((m) => m.id);

  it("includes deepseek-v4-pro", () => {
    expect(ids).toContain("deepseek-v4-pro");
  });

  it("includes deepseek-v4-flash", () => {
    expect(ids).toContain("deepseek-v4-flash");
  });
});

describe("opencode-go thinking config", () => {
  it("defines THINKING_CONFIG.deepseek options", () => {
    expect(THINKING_CONFIG.deepseek).toEqual({
      options: ["auto", "low", "medium", "high", "max"],
      defaultMode: "auto",
    });
  });

  it("attaches deepseek thinking config to opencode-go", () => {
    expect(AI_PROVIDERS["opencode-go"].thinkingConfig).toBe(THINKING_CONFIG.deepseek);
  });
});

import { applyProviderThinkingOverride } from "../../open-sse/handlers/chatCore/providerThinking.js";

describe("applyProviderThinkingOverride", () => {
  const baseBody = { messages: [{ role: "user", content: "hi" }] };

  it("returns unchanged body for auto mode", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "auto" },
    });
    expect(out).toEqual(baseBody);
  });

  it("sets thinking enabled + low effort for deepseek-v4-pro", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "low" },
    });
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("low");
  });

  it("sets thinking enabled + medium effort for deepseek-v4-pro", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "medium" },
    });
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("medium");
  });

  it("sets thinking enabled + high effort for deepseek-v4-pro", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "high" },
    });
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("high");
  });

  it("sets thinking enabled + max effort for deepseek-v4-pro", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "max" },
    });
    expect(out.thinking).toEqual({ type: "enabled" });
    expect(out.reasoning_effort).toBe("max");
  });

  it("does not override existing client reasoning_effort", () => {
    const out = applyProviderThinkingOverride({
      body: { ...baseBody, reasoning_effort: "low" },
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "max" },
    });
    expect(out.reasoning_effort).toBe("low");
  });

  it("does not override existing client thinking", () => {
    const out = applyProviderThinkingOverride({
      body: { ...baseBody, thinking: { type: "disabled" } },
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "high" },
    });
    expect(out.thinking).toEqual({ type: "disabled" });
  });

  it("does not apply deepseek logic to non-deepseek opencode-go models", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "kimi-k2.6",
      providerThinking: { mode: "high" },
    });
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBe("high");
  });

  it("handles on mode for extended thinking providers", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "codex",
      model: "gpt-5.5",
      providerThinking: { mode: "on" },
    });
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  it("handles off mode for extended thinking providers", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "codex",
      model: "gpt-5.5",
      providerThinking: { mode: "off" },
    });
    expect(out.thinking).toEqual({ type: "disabled" });
  });

  it("returns unchanged body when providerThinking is null", () => {
    const out = applyProviderThinkingOverride({
      body: baseBody,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: null,
    });
    expect(out).toEqual(baseBody);
  });
});

describe("applyProviderThinkingOverride — developer role conversion", () => {
  it("converts developer role to system for opencode-go deepseek-v4-pro", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are concise" },
        { role: "user", content: "hi" },
      ],
    };
    const out = applyProviderThinkingOverride({
      body,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
      providerThinking: { mode: "auto" },
    });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toBe("You are concise");
  });

  it("converts developer role to system for opencode-go deepseek-v4-flash", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are concise" },
        { role: "user", content: "hi" },
      ],
    };
    const out = applyProviderThinkingOverride({
      body,
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      providerThinking: { mode: "auto" },
    });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toBe("You are concise");
  });

  it("does not convert developer for non-deepseek opencode-go models", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are concise" },
        { role: "user", content: "hi" },
      ],
    };
    const out = applyProviderThinkingOverride({
      body,
      provider: "opencode-go",
      model: "kimi-k2.6",
      providerThinking: { mode: "auto" },
    });
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("developer");
  });
});
