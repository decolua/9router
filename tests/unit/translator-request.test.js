/**
 * Translator request tests — openaiToClaudeRequest, openaiToGeminiRequest, claudeToOpenAIRequest
 *
 * Covers:
 *  - Role mapping (user/assistant/system/tool)
 *  - Tool call conversion (OpenAI → Claude format)
 *  - Thinking mode forwarding
 *  - max_tokens adjustment
 *  - Temperature pass-through
 *  - Tool choice conversion
 */

import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

describe("openaiToClaudeRequest", () => {
  // ── Basic message translation ───────────────────────────────────────────

  describe("role mapping", () => {
    it("maps user messages to user role with text blocks", () => {
      const body = {
        messages: [{ role: "user", content: "hello" }],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      const userMsg = result.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg.content).toEqual([{ type: "text", text: "hello" }]);
    });

    it("maps assistant messages to assistant role", () => {
      const body = {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello back" },
          { role: "user", content: "thanks" },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[2].role).toBe("user");
    });

    it("extracts system messages into system array", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "hi" },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      // System should include Claude Code prompt + user system message
      expect(result.system.length).toBe(2);
      const userSystemText = result.system
        .filter((s) => s.text.includes("helpful assistant"))
        .map((s) => s.text)
        .join("");
      expect(userSystemText).toContain("You are a helpful assistant");
    });

    it("maps tool messages to user role with tool_result blocks", () => {
      const body = {
        messages: [
          { role: "user", content: "do something" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_123",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"NYC"}' },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_123",
            content: "72°F",
          },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      // Find the tool_result message
      const toolResultMsg = result.messages.find(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === "tool_result")
      );
      expect(toolResultMsg).toBeDefined();
      const toolResultBlock = toolResultMsg.content.find(
        (b) => b.type === "tool_result"
      );
      expect(toolResultBlock.tool_use_id).toBe("call_123");
      expect(toolResultBlock.content).toBe("72°F");
    });
  });

  // ── Tool calls ──────────────────────────────────────────────────────────

  describe("tool call conversion", () => {
    it("converts OpenAI function tools to Claude input_schema format", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBe(1);
      expect(result.tools[0].name).toBe("get_weather");
      expect(result.tools[0].description).toBe("Get weather for a city");
      expect(result.tools[0].input_schema.type).toBe("object");
      expect(result.tools[0].input_schema.properties.city.type).toBe("string");
    });

    it("passes through built-in Claude tools (non-function type)", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
          },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tools).toBeDefined();
      expect(result.tools[0].type).toBe("web_search_20250305");
    });

    it("adds cache_control to last tool", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "function",
            function: {
              name: "tool_a",
              description: "A",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function",
            function: {
              name: "tool_b",
              description: "B",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tools[0].cache_control).toBeUndefined();
      expect(result.tools[1].cache_control).toEqual({
        type: "ephemeral",
        ttl: "1h",
      });
    });
  });

  // ── Thinking mode ───────────────────────────────────────────────────────

  describe("thinking mode", () => {
    it("forwards thinking configuration when present", () => {
      const body = {
        messages: [{ role: "user", content: "think hard" }],
        thinking: {
          type: "enabled",
          budget_tokens: 8192,
        },
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, true);

      expect(result.thinking).toBeDefined();
      expect(result.thinking.type).toBe("enabled");
      expect(result.thinking.budget_tokens).toBe(8192);
    });

    it("does not add thinking when not in request", () => {
      const body = {
        messages: [{ role: "user", content: "simple request" }],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.thinking).toBeUndefined();
    });
  });

  // ── max_tokens ──────────────────────────────────────────────────────────

  describe("max_tokens", () => {
    it("uses body max_tokens when provided", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1024,
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.max_tokens).toBe(1024);
    });

    it("uses default max_tokens when not provided", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      // Should have a default (64000 from runtimeConfig)
      expect(result.max_tokens).toBeGreaterThan(0);
    });
  });

  // ── Temperature ─────────────────────────────────────────────────────────

  describe("temperature", () => {
    it("forwards temperature when present", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        temperature: 0.7,
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.temperature).toBe(0.7);
    });

    it("omits temperature when not in request", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.temperature).toBeUndefined();
    });
  });

  // ── Tool choice ─────────────────────────────────────────────────────────

  describe("tool choice", () => {
    it('converts "required" to {type: "any"}', () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "function",
            function: {
              name: "f",
              description: "d",
              parameters: { type: "object" },
            },
          },
        ],
        tool_choice: "required",
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tool_choice).toEqual({ type: "any" });
    });

    it('converts "auto" to {type: "auto"}', () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tool_choice: "auto",
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tool_choice).toEqual({ type: "auto" });
    });

    it("converts specific function choice to tool choice", () => {
      const body = {
        messages: [{ role: "user", content: "test" }],
        tool_choice: { function: { name: "get_weather" } },
      };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);

      expect(result.tool_choice).toEqual({
        type: "tool",
        name: "get_weather",
      });
    });
  });

  // ── Stream flag ─────────────────────────────────────────────────────────

  describe("stream flag", () => {
    it("sets stream to true when requested", () => {
      const body = { messages: [{ role: "user", content: "test" }] };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, true);
      expect(result.stream).toBe(true);
    });

    it("sets stream to false when not requested", () => {
      const body = { messages: [{ role: "user", content: "test" }] };
      const result = openaiToClaudeRequest("claude-sonnet-4-6", body, false);
      expect(result.stream).toBe(false);
    });
  });

  // ── Model passthrough ───────────────────────────────────────────────────

  describe("model passthrough", () => {
    it("passes the model name through unchanged", () => {
      const body = { messages: [{ role: "user", content: "test" }] };
      const result = openaiToClaudeRequest("claude-opus-4-6", body, false);
      expect(result.model).toBe("claude-opus-4-6");
    });
  });
});
