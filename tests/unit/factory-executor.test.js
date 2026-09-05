import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  FactoryExecutor,
  resolveTargetGateway,
  upstreamProviderFor,
  resolveFactoryApiBase,
  resolveClaudeThinking,
  embeddedToolCallFromName,
  FACTORY_DROID_SYSTEM_PROMPT,
  FACTORY_OPENAI_PLATFORM_ORG,
  ANTHROPIC_VERSION,
  ANTHROPIC_BETAS,
  ANTHROPIC_EFFORT_BETA,
} from "../../open-sse/executors/factory.js";

describe("FactoryExecutor", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FACTORY_API_BASE;
    delete process.env.FACTORY_ORG_ID;
    delete process.env.FACTORY_ORGANIZATION_ID;
    delete process.env.FACTORY_UPSTREAM_CLIENT_TYPE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("resolveTargetGateway", () => {
    it("routes Claude and MiniMax models to Anthropic Messages gateway", () => {
      expect(resolveTargetGateway("claude-opus-5")).toBe("anthropic");
      expect(resolveTargetGateway("claude-sonnet-5")).toBe("anthropic");
      expect(resolveTargetGateway("claude-fable-5")).toBe("anthropic");
      expect(resolveTargetGateway("claude-fable-5.1")).toBe("anthropic");
      expect(resolveTargetGateway("atlas-07-21")).toBe("anthropic");
      expect(resolveTargetGateway("aster-07-15")).toBe("anthropic");
      expect(resolveTargetGateway("minimax-m3")).toBe("anthropic");
      expect(resolveTargetGateway("minimax-m2.7")).toBe("anthropic");
    });

    it("routes GPT, Codex, and Grok models to OpenAI Responses gateway", () => {
      expect(resolveTargetGateway("gpt-6-astra")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.6-sol")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.4")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5.3-codex")).toBe("openai-responses");
      expect(resolveTargetGateway("gpt-5-codex")).toBe("openai-responses");
      expect(resolveTargetGateway("grok-4.6")).toBe("openai-responses");
      expect(resolveTargetGateway("grok-4.5")).toBe("openai-responses");
    });

    it("routes Core open-weight models to OpenAI Chat Completions gateway", () => {
      expect(resolveTargetGateway("glm-5.3")).toBe("openai-completions");
      expect(resolveTargetGateway("glm-5.2")).toBe("openai-completions");
      expect(resolveTargetGateway("kimi-k3")).toBe("openai-completions");
      expect(resolveTargetGateway("kimi-k2.7-code")).toBe("openai-completions");
      expect(resolveTargetGateway("deepseek-v4-pro")).toBe("openai-completions");
      expect(resolveTargetGateway("deepseek-v4-flash-0731")).toBe("openai-completions");
      expect(resolveTargetGateway("nemotron-3-ultra")).toBe("openai-completions");
      expect(resolveTargetGateway("inkling")).toBe("openai-completions");
    });
  });

  describe("upstreamProviderFor", () => {
    it("returns anthropic for Claude family", () => {
      expect(upstreamProviderFor("claude-opus-5")).toBe("anthropic");
      expect(upstreamProviderFor("claude-sonnet-4-6")).toBe("anthropic");
      expect(upstreamProviderFor("atlas-07-21")).toBe("anthropic");
    });

    it("returns openai for GPT and Codex models", () => {
      expect(upstreamProviderFor("gpt-6-astra")).toBe("openai");
      expect(upstreamProviderFor("gpt-5.6-sol")).toBe("openai");
      expect(upstreamProviderFor("gpt-5.3-codex")).toBe("openai");
    });

    it("returns xai for Grok models", () => {
      expect(upstreamProviderFor("grok-4.6")).toBe("xai");
      expect(upstreamProviderFor("grok-4.5")).toBe("xai");
    });

    it("returns fireworks for open models and MiniMax", () => {
      expect(upstreamProviderFor("minimax-m3")).toBe("fireworks");
      expect(upstreamProviderFor("glm-5.3")).toBe("fireworks");
      expect(upstreamProviderFor("kimi-k3")).toBe("fireworks");
      expect(upstreamProviderFor("deepseek-v4-pro")).toBe("fireworks");
      expect(upstreamProviderFor("nemotron-3-ultra")).toBe("fireworks");
      expect(upstreamProviderFor("inkling")).toBe("fireworks");
    });
  });

  describe("resolveFactoryApiBase", () => {
    it("defaults to https://api.factory.ai", () => {
      expect(resolveFactoryApiBase()).toBe("https://api.factory.ai");
    });

    it("uses credentials.providerSpecificData.apiEndpoint if provided", () => {
      const creds = { providerSpecificData: { apiEndpoint: "https://api.eu.factory.ai/" } };
      expect(resolveFactoryApiBase(creds)).toBe("https://api.eu.factory.ai");
    });

    it("prefers FACTORY_API_BASE environment variable over credentials", () => {
      process.env.FACTORY_API_BASE = "https://custom.factory.ai/";
      const creds = { providerSpecificData: { apiEndpoint: "https://api.eu.factory.ai" } };
      expect(resolveFactoryApiBase(creds)).toBe("https://custom.factory.ai");
    });
  });

  describe("embeddedToolCallFromName", () => {
    it("parses valid embedded JSON string in tool name", () => {
      const parsed = embeddedToolCallFromName('{"name":"read","arguments":{"path":"src/router.ts"}}');
      expect(parsed).toEqual({
        name: "read",
        arguments: { path: "src/router.ts" },
      });
    });

    it("parses stringified JSON inside arguments", () => {
      const parsed = embeddedToolCallFromName('{"name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}');
      expect(parsed).toEqual({
        name: "bash",
        arguments: { command: "ls" },
      });
    });

    it("returns null for non-JSON names", () => {
      expect(embeddedToolCallFromName("Read")).toBeNull();
      expect(embeddedToolCallFromName("read_file")).toBeNull();
      expect(embeddedToolCallFromName("{invalid-json")).toBeNull();
    });
  });

  describe("resolveClaudeThinking", () => {
    it("configures adaptive thinking with summarized display for Claude Fable and Opus 5/4.8", () => {
      for (const m of ["claude-fable-5.1", "claude-fable-5", "claude-opus-5", "claude-opus-4-8"]) {
        const config = resolveClaudeThinking(m, "medium");
        expect(config.thinking).toEqual({ type: "adaptive", display: "summarized" });
        expect(config.outputConfig).toEqual({ effort: "medium" });
        expect(config.requiresEffortBeta).toBe(true);
      }
    });

    it("configures adaptive thinking without display property for Claude Sonnet 4.6", () => {
      const config = resolveClaudeThinking("claude-sonnet-4-6", "high");
      expect(config.thinking).toEqual({ type: "adaptive" });
      expect(config.outputConfig).toEqual({ effort: "high" });
      expect(config.requiresEffortBeta).toBe(true);
    });

    it("configures enabled budget thinking for Claude Opus 4.5", () => {
      const config = resolveClaudeThinking("claude-opus-4-5-20251101", "high");
      expect(config.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
      expect(config.outputConfig).toEqual({ effort: "high" });
      expect(config.requiresEffortBeta).toBe(true);
    });

    it("configures enabled thinking with budget_tokens and without effort for MiniMax", () => {
      const configHigh = resolveClaudeThinking("minimax-m3", "high");
      expect(configHigh.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
      expect(configHigh.outputConfig).toBeUndefined();
      expect(configHigh.requiresEffortBeta).toBe(false);

      const configDefault = resolveClaudeThinking("minimax-m2.7");
      expect(configDefault.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
      expect(configDefault.outputConfig).toBeUndefined();

      const configCustom = resolveClaudeThinking("minimax-m2.7", 3000);
      expect(configCustom.thinking).toEqual({ type: "enabled", budget_tokens: 3000 });
    });
  });

  describe("buildUrl", () => {
    const executor = new FactoryExecutor();

    it("builds Anthropic messages URL for Claude", () => {
      expect(executor.buildUrl("claude-opus-5", true)).toBe("https://api.factory.ai/api/llm/a/v1/messages");
    });

    it("builds OpenAI Responses URL for GPT and Grok", () => {
      expect(executor.buildUrl("gpt-5.4", true)).toBe("https://api.factory.ai/api/llm/o/v1/responses");
      expect(executor.buildUrl("grok-4.6", true)).toBe("https://api.factory.ai/api/llm/o/v1/responses");
    });

    it("builds Chat Completions URL for Kimi and GLM", () => {
      expect(executor.buildUrl("kimi-k3", true)).toBe("https://api.factory.ai/api/llm/o/v1/chat/completions");
      expect(executor.buildUrl("glm-5.3", true)).toBe("https://api.factory.ai/api/llm/o/v1/chat/completions");
    });
  });

  describe("buildHeaders", () => {
    const executor = new FactoryExecutor();

    it("attaches client identity, auth token, and org id", () => {
      const creds = {
        accessToken: "workos-token-123",
        providerSpecificData: { orgId: "RFmWaCAuH8jTGM21tL5k" },
      };
      const headers = executor.buildHeaders(creds, true, "", "claude-fable-5.1");

      expect(headers["X-Factory-Client"]).toBe("cli");
      expect(headers["X-Client-Version"]).toBe("0.213.0");
      expect(headers["User-Agent"]).toBe("factory-cli/0.213.0");
      expect(headers["Authorization"]).toBe("Bearer workos-token-123");
      expect(headers["X-Factory-Org-Id"]).toBe("RFmWaCAuH8jTGM21tL5k");
    });

    it("appends effort beta header for adaptive Claude models", () => {
      const creds = { accessToken: "tok" };
      const headers = executor.buildHeaders(creds, true, "", "claude-fable-5.1");

      expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
      expect(headers["anthropic-beta"]).toContain("fine-grained-tool-streaming-2025-05-14");
      expect(headers["anthropic-beta"]).toContain("interleaved-thinking-2025-05-14");
      expect(headers["anthropic-beta"]).toContain(ANTHROPIC_EFFORT_BETA);
    });

    it("does not include effort beta header for MiniMax", () => {
      const creds = { accessToken: "tok" };
      const headers = executor.buildHeaders(creds, true, "", "minimax-m3");

      expect(headers["anthropic-beta"]).not.toContain(ANTHROPIC_EFFORT_BETA);
    });

    it("attaches OpenAI-Platform and x-api-provider: xai for Grok", () => {
      const creds = { accessToken: "tok" };
      const headers = executor.buildHeaders(creds, true, "", "grok-4.6");

      expect(headers["OpenAI-Platform"]).toBe(FACTORY_OPENAI_PLATFORM_ORG);
      expect(headers["x-api-provider"]).toBe("xai");
    });

    it("attaches x-session-id and x-assistant-message-id UUID headers", () => {
      const creds = { accessToken: "tok" };
      const headers = executor.buildHeaders(creds, true, "", "gpt-5.4");

      expect(headers["x-session-id"]).toBeDefined();
      expect(headers["x-assistant-message-id"]).toBeDefined();
    });
  });

  describe("transformRequest - Tool Formatting & Preservation", () => {
    const executor = new FactoryExecutor();

    it("preserves tool names verbatim without mutation", () => {
      const body = {
        messages: [{ role: "user", content: "Inspect code" }],
        tools: [
          {
            type: "function",
            function: { name: "read_file", description: "Read a file", parameters: { type: "object" } },
          },
          {
            type: "function",
            function: { name: "bash", description: "Run shell command", parameters: { type: "object" } },
          },
          {
            type: "function",
            function: { name: "grep_search", description: "Search pattern", parameters: { type: "object" } },
          },
        ],
      };

      const transformed = executor.transformRequest("kimi-k3", body, true);
      const toolNames = transformed.tools.map((t) => t.function.name);

      expect(toolNames).toEqual(["read_file", "bash", "grep_search"]);
    });

    it("formats tools for Claude Anthropic Messages gateway with input_schema", () => {
      const body = {
        messages: [{ role: "user", content: "Inspect code" }],
        tools: [
          { name: "view_file", description: "View file", parameters: { type: "object" } },
          { name: "write_file", description: "Write file", input_schema: { type: "object" } },
        ],
      };

      const transformed = executor.transformRequest("claude-fable-5.1", body, true);
      expect(transformed.tools).toEqual([
        { name: "view_file", description: "View file", input_schema: { type: "object" } },
        { name: "write_file", description: "Write file", input_schema: { type: "object" } },
      ]);
    });

    it("formats tools to flat Responses format for GPT and Grok", () => {
      const body = {
        input: [{ role: "user", content: [{ type: "input_text", text: "Find files" }] }],
        tools: [
          {
            type: "function",
            function: { name: "find_files", description: "Find files", parameters: { type: "object" } },
          },
        ],
      };

      const transformed = executor.transformRequest("gpt-5.4", body, true);
      expect(transformed.tools[0]).toEqual({
        type: "function",
        name: "find_files",
        description: "Find files",
        parameters: { type: "object" },
      });
      expect(transformed.tool_choice).toBe("auto");
      expect(transformed.parallel_tool_calls).toBe(true);
      expect(transformed.store).toBe(false);
    });

    it("preserves tool calls and tool results in conversation history", () => {
      const body = {
        messages: [
          { role: "user", content: "Inspect" },
          {
            role: "assistant",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", name: "read_file", content: "file data" },
        ],
        tools: [
          {
            type: "function",
            function: { name: "read_file", parameters: { type: "object" } },
          },
        ],
      };

      const transformed = executor.transformRequest("kimi-k3", body, true);
      const asstMsg = transformed.messages.find((m) => m.role === "assistant");
      const toolMsg = transformed.messages.find((m) => m.role === "tool");
      expect(asstMsg.tool_calls[0].function.name).toBe("read_file");
      expect(toolMsg.name).toBe("read_file");
    });

    it("ensures Kimi tool result messages have name attribute resolved from matching tool call", () => {
      const body = {
        messages: [
          { role: "user", content: "Inspect" },
          {
            role: "assistant",
            tool_calls: [
              { id: "call_kimi_1", type: "function", function: { name: "read_file", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "call_kimi_1", content: "output" },
        ],
      };

      const transformed = executor.transformRequest("kimi-k3", body, true);
      const toolResult = transformed.messages.find((m) => m.role === "tool");
      expect(toolResult.name).toBe("read_file");
    });

    it("ensures assistant messages with tool calls carry reasoning_content on completions gateway", () => {
      const body = {
        messages: [
          {
            role: "assistant",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } },
            ],
          },
        ],
      };

      const kimiTransformed = executor.transformRequest("kimi-k3", body, true);
      const kimiAsst = kimiTransformed.messages.find((m) => m.role === "assistant");
      expect(kimiAsst.reasoning_content).toBe(".");
      expect(kimiAsst.content).toBe("");

      const deepseekTransformed = executor.transformRequest("deepseek-v4-pro", body, true);
      const dsAsst = deepseekTransformed.messages.find((m) => m.role === "assistant");
      expect(dsAsst.reasoning_content).toBe("");
      expect(dsAsst.content).toBe("");
    });
  });

  describe("transformRequest - System Prompt & Identities", () => {
    const executor = new FactoryExecutor();

    it("injects FACTORY_DROID_SYSTEM_PROMPT into Anthropic system", () => {
      const body = { messages: [{ role: "user", content: "Hello" }] };
      const transformed = executor.transformRequest("claude-fable-5.1", body, true);

      expect(transformed.system).toEqual([{ type: "text", text: FACTORY_DROID_SYSTEM_PROMPT }]);
      expect(transformed.thinking).toEqual({ type: "adaptive", display: "summarized" });
      expect(transformed.output_config).toEqual({ effort: "high" });
      expect(transformed.max_tokens).toBe(4096);
    });

    it("configures MiniMax with budget_tokens, no output_config, and raises max_tokens if needed", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };
      const transformed = executor.transformRequest("minimax-m2.7", body, false);

      expect(transformed.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
      expect(transformed.output_config).toBeUndefined();
      expect(transformed.max_tokens).toBe(3072); // 2048 + 1024
    });

    it("strips competing Claude Code identity from system prompt", () => {
      const body = {
        system: "You are Claude Code, Anthropic's official CLI for Claude. Be concise.",
        messages: [{ role: "user", content: "Hello" }],
      };
      const transformed = executor.transformRequest("claude-fable-5.1", body, false);

      expect(transformed.system).not.toContain("You are Claude Code");
      expect(transformed.system).toContain("Be concise.");
      expect(transformed.system).toContain(FACTORY_DROID_SYSTEM_PROMPT);
    });

    it("strips server IDs and system turns from OpenAI Responses input", () => {
      const body = {
        input: [
          { role: "system", content: "You are Claude Code, official CLI. Plan carefully." },
          { id: "rs_12345", type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
          { role: "user", content: [{ type: "input_text", text: "Next step" }] },
        ],
      };
      const transformed = executor.transformRequest("gpt-5.4", body, true);

      expect(transformed.instructions).not.toContain("You are Claude Code");
      expect(transformed.instructions).toContain("Plan carefully.");
      expect(transformed.instructions).toContain(FACTORY_DROID_SYSTEM_PROMPT);
      expect(transformed.store).toBe(false);
      // System turn stripped from input; server id rs_ stripped
      const hasSystem = transformed.input.some((turn) => turn.role === "system");
      expect(hasSystem).toBe(false);
      const assistantTurn = transformed.input.find((turn) => turn.role === "assistant");
      expect(assistantTurn.id).toBeUndefined();
    });

    it("sets reasoning_history to interleaved for DeepSeek and preserved for others", () => {
      const ds = executor.transformRequest("deepseek-v4-pro", { messages: [] });
      expect(ds.reasoning_history).toBe("interleaved");

      const kimi = executor.transformRequest("kimi-k3", { messages: [] });
      expect(kimi.reasoning_history).toBe("preserved");

      const glm = executor.transformRequest("glm-5.3", { messages: [] });
      expect(glm.reasoning_history).toBe("preserved");
    });
  });

  describe("Non-streaming response translation (Responses & Claude → OpenAI)", () => {
    it("converts OpenAI Responses non-streaming output to OpenAI Chat Completion with choices and tool_calls", async () => {
      const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
      const responsesOutput = {
        id: "resp_abc123",
        object: "response",
        created_at: 1700000000,
        model: "gpt-5.6-sol",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Here is the file." }],
          },
          {
            type: "function_call",
            call_id: "call_read_1",
            name: "read_file",
            arguments: "{\"path\":\"package.json\"}",
          },
        ],
        usage: {
          input_tokens: 150,
          output_tokens: 25,
          total_tokens: 175,
        },
      };

      const converted = translateNonStreamingResponse(responsesOutput, "openai-responses", "openai");
      expect(converted.object).toBe("chat.completion");
      expect(converted.id).toBe("chatcmpl-abc123");
      expect(converted.choices).toHaveLength(1);
      expect(converted.choices[0].finish_reason).toBe("tool_calls");
      expect(converted.choices[0].message.content).toBe("Here is the file.");
      expect(converted.choices[0].message.tool_calls).toHaveLength(1);
      expect(converted.choices[0].message.tool_calls[0].function.name).toBe("read_file");
      expect(converted.choices[0].message.tool_calls[0].function.arguments).toBe("{\"path\":\"package.json\"}");
      expect(converted.usage.prompt_tokens).toBe(150);
      expect(converted.usage.completion_tokens).toBe(25);
    });

    it("unwraps embedded JSON tool name in Claude non-streaming tool_use block", async () => {
      const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
      const claudeOutput = {
        id: "msg_123",
        model: "claude-fable-5.1",
        content: [
          {
            type: "tool_use",
            id: "toolu_456",
            name: JSON.stringify({ name: "read_file", arguments: { path: "src/index.js" } }),
            input: { path: "src/index.js" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 30 },
      };

      const converted = translateNonStreamingResponse(claudeOutput, "claude", "openai");
      expect(converted.choices).toHaveLength(1);
      expect(converted.choices[0].finish_reason).toBe("tool_calls");
      expect(converted.choices[0].message.tool_calls[0].function.name).toBe("read_file");
    });
  });
});

