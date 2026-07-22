/**
 * GitHub Copilot serves Claude models on its Anthropic-native /v1/messages shim.
 * chatCore must resolve those models to the "claude" target format so a Claude-source
 * request (Claude Code / Zed, directly or via a downstream Anthropic proxy) reaches
 * the shim with zero translation.
 *
 * Before this route existed the request went claude -> openai -> claude, and
 * request/claude-to-openai.js has no case for thinking blocks: the assistant turn's
 * thinking block (and its signature) was silently dropped on the way in, so the model
 * never saw its own prior reasoning on the next turn.
 */

import { describe, it, expect } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { resolveDynamicTargetFormat, getTargetFormat } from "../../open-sse/services/provider.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A real Copilot thinking signature (E-form, truncated) — must survive verbatim.
const SIGNATURE = "EpwGCkYIChgCKkCzVUuRrg7CcglSUWEef4rH6o35g9UYS8ZPe0/VomQTBsFx6sttYNj5";

function claudeMultiTurnBody() {
  return {
    model: "claude-sonnet-4.6",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    tools: [{ name: "get_weather", description: "w", input_schema: { type: "object", properties: {} } }],
    messages: [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should call the weather tool.", signature: SIGNATURE },
          { type: "tool_use", id: "toolu_01", name: "get_weather", input: { city: "Beijing" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "sunny" }] },
    ],
  };
}

describe("github dynamic target format", () => {
  it("routes claude-* to the Anthropic-native format", () => {
    for (const model of ["claude-sonnet-4.6", "claude-opus-4.7", "claude-haiku-4.5"]) {
      expect(resolveDynamicTargetFormat("github", model)).toBe("claude");
    }
  });

  // The whole reason this is a name pattern and not a static per-model registry field.
  it("covers live-catalog models the static registry list has not caught up with", () => {
    for (const model of ["claude-sonnet-5", "claude-opus-4.8", "claude-opus-4.8-fast", "claude-fable-5"]) {
      expect(resolveDynamicTargetFormat("github", model)).toBe("claude");
    }
  });

  it("leaves every other Copilot model on the provider default", () => {
    for (const model of ["gpt-5.4", "gpt-5.2-codex", "gemini-3-flash-preview", "grok-code-fast-1"]) {
      expect(resolveDynamicTargetFormat("github", model)).toBeNull();
    }
    expect(getTargetFormat("github")).toBe("openai");
  });

  it("is inert for providers that declare no hook, and null-safe", () => {
    expect(resolveDynamicTargetFormat("openai", "gpt-4")).toBeNull();
    expect(resolveDynamicTargetFormat("anthropic", "claude-sonnet-4.6")).toBeNull();
    expect(resolveDynamicTargetFormat("github", null)).toBeNull();
    expect(resolveDynamicTargetFormat("no-such-provider", "x")).toBeNull();
  });
});

describe("GithubExecutor.buildUrl", () => {
  const exec = new GithubExecutor();

  it("posts Claude models to /v1/messages", () => {
    expect(exec.buildUrl("claude-sonnet-4.6", true)).toBe("https://api.githubcopilot.com/v1/messages");
    expect(exec.buildUrl("claude-fable-5", true)).toBe("https://api.githubcopilot.com/v1/messages");
  });

  it("posts everything else to /chat/completions", () => {
    expect(exec.buildUrl("gpt-5.4", true)).toBe("https://api.githubcopilot.com/chat/completions");
    expect(exec.buildUrl("gemini-3-flash-preview", true)).toBe("https://api.githubcopilot.com/chat/completions");
  });

  it("leaves an Anthropic-native body untouched in transformRequest", () => {
    const body = { model: "claude-sonnet-4.6", max_tokens: 10, thinking: { type: "adaptive" } };
    expect(exec.transformRequest("claude-sonnet-4.6", body, true, {})).toBe(body);
  });
});

describe("claude -> claude passthrough for github", () => {
  it("preserves the assistant thinking block and its signature verbatim", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4.6",
      claudeMultiTurnBody(), true, {}, "github"
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    const thinking = assistant.content.find((b) => b.type === "thinking");

    expect(thinking).toBeDefined();
    expect(thinking.thinking).toBe("I should call the weather tool.");
    expect(thinking.signature).toBe(SIGNATURE);
    // thinking must stay first — Anthropic rejects a thinking block after content
    expect(assistant.content[0].type).toBe("thinking");
  });

  it("still injects cache_control (the reason Claude models use /v1/messages at all)", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4.6",
      claudeMultiTurnBody(), true, {}, "github"
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    const cached = assistant.content.filter((b) => b.cache_control);
    expect(cached.length).toBeGreaterThan(0);
    // never on a thinking block — Anthropic rejects cache_control there
    expect(cached.every((b) => b.type !== "thinking")).toBe(true);
  });

  it("leaves the thinking config untouched", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.CLAUDE, "claude-sonnet-4.6",
      claudeMultiTurnBody(), true, {}, "github"
    );
    expect(out.thinking).toEqual({ type: "adaptive" });
    expect(out.output_config).toEqual({ effort: "high" });
  });

  // Guards the old behaviour so a future refactor cannot quietly reintroduce it.
  it("documents that the claude -> openai hop drops thinking blocks", () => {
    const out = translateRequest(
      FORMATS.CLAUDE, FORMATS.OPENAI, "claude-sonnet-4.6",
      claudeMultiTurnBody(), true, {}, "github"
    );
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content).toBeUndefined();
    expect(assistant.tool_calls).toHaveLength(1);
  });
});

describe("openai -> claude for github (OpenAI-format clients)", () => {
  it("still translates and injects cache_control", () => {
    const out = translateRequest(
      FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4.6",
      {
        model: "claude-sonnet-4.6", max_tokens: 2048, reasoning_effort: "high",
        messages: [
          { role: "user", content: "weather?" },
          { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "call_1", content: "sunny" },
        ],
      },
      true, {}, "github"
    );
    expect(out.thinking).toEqual({ type: "adaptive" });
    expect(out.output_config).toEqual({ effort: "high" });
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.cache_control)).toBe(true);
  });
});
