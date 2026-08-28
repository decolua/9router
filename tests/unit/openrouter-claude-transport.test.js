import { describe, expect, it } from "vitest";
import { resolveTransport } from "open-sse/services/provider.js";
import { translateRequest } from "open-sse/translator/index.js";
import { DefaultExecutor } from "open-sse/executors/default.js";

const MODEL = "z-ai/glm-5.3-flash";

function claudeBody() {
  return {
    model: MODEL,
    stream: true,
    max_tokens: 32000,
    thinking: { type: "enabled", budget_tokens: 16000 },
    system: [{ type: "text", text: "You are helpful." }],
    messages: [{ role: "user", content: [{ type: "text", text: "List files and read two of them." }] }],
    tools: [{ name: "Read", description: "Read a file", input_schema: { type: "object", properties: { file_path: { type: "string" } } } }],
  };
}

describe("openrouter claude transport (/v1/messages)", () => {
  it("resolveTransport matches claude and falls back to default for other formats", () => {
    const rt = resolveTransport("openrouter", "claude");
    expect(rt?.baseUrl).toBe("https://openrouter.ai/api/v1/messages");
    expect(rt?.thinkingFormat).toBe("claude-budget");
    expect(resolveTransport("openrouter", "openai")).toBeNull();
    expect(resolveTransport("openrouter", "gemini")).toBeNull();
  });

  it("claude passthrough keeps native thinking (transport thinkingFormat wins over provider's openai)", () => {
    const credentials = { apiKey: "test-key", runtimeTransport: resolveTransport("openrouter", "claude") };
    const body = translateRequest("claude", "claude", MODEL, claudeBody(), true, credentials, "openrouter");

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking?.type).toBe("enabled");
    expect(body.thinking?.budget_tokens).toBeGreaterThan(0);
    // prepareClaudeRequest invariant: Anthropic requires max_tokens > budget_tokens
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it("openai path unchanged: provider thinkingFormat still maps thinking to reasoning_effort", () => {
    const credentials = { apiKey: "test-key" }; // no runtimeTransport → default transport
    const body = translateRequest("claude", "openai", MODEL, claudeBody(), true, credentials, "openrouter");

    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeDefined();
  });

  it("executor routes url/headers through the transport (bearer auth, no hardcoded brand)", () => {
    const credentials = { apiKey: "sk-or-test", runtimeTransport: resolveTransport("openrouter", "claude") };
    const executor = new DefaultExecutor("openrouter");

    expect(executor.buildUrl(MODEL, true, 0, credentials)).toBe("https://openrouter.ai/api/v1/messages");
    const headers = executor.buildHeaders(credentials, true, "https://openrouter.ai/api/v1/messages", MODEL);
    expect(headers["Authorization"]).toBe("Bearer sk-or-test");
    expect(headers["x-api-key"]).toBeUndefined();
    // no client UA → no attribution headers at all
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
    expect(headers["User-Agent"]).toBeUndefined();
  });

  it("attributes traffic to the calling client via X-Title + forwarded User-Agent", () => {
    const executor = new DefaultExecutor("openrouter");
    const ua = "claude-cli/2.1.250 (external, cli)";

    // claude transport (/v1/messages)
    const claudeCreds = {
      apiKey: "sk-or-test",
      runtimeTransport: resolveTransport("openrouter", "claude"),
      rawHeaders: { "user-agent": ua },
    };
    const claudeHeaders = executor.buildHeaders(claudeCreds, true, "https://openrouter.ai/api/v1/messages", MODEL);
    expect(claudeHeaders["X-Title"]).toBe("Claude Code");
    expect(claudeHeaders["User-Agent"]).toBe(ua);

    // default transport (/chat/completions) uses the same hook
    const openaiCreds = { apiKey: "sk-or-test", rawHeaders: { "user-agent": "codex-tui/0.44.0" } };
    const openaiHeaders = executor.buildHeaders(openaiCreds, true, "https://openrouter.ai/api/v1/chat/completions", MODEL);
    expect(openaiHeaders["X-Title"]).toBe("Codex");
    expect(openaiHeaders["User-Agent"]).toBe("codex-tui/0.44.0");

    // unknown client falls back to the UA product token
    const otherCreds = { apiKey: "sk-or-test", rawHeaders: { "user-agent": "meu-agente/1.0" } };
    const otherHeaders = executor.buildHeaders(otherCreds, true, "https://openrouter.ai/api/v1/chat/completions", MODEL);
    expect(otherHeaders["X-Title"]).toBe("meu-agente");
  });
});
