import { describe, it, expect } from "vitest";
import { normalizeKiroToolSpecs } from "../../open-sse/translator/concerns/kiroConversation.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { kiroToOpenAIResponse } from "../../open-sse/translator/response/kiro-to-openai.js";
import { kiroToClaudeResponse, kiroToClaudeNonStreaming } from "../../open-sse/translator/response/kiro-to-claude.js";

describe("Kiro tool name normalization and roundtrip", () => {
  it("preserves consecutive underscores like mcp__gitea__search_repos without collapsing", () => {
    const { specs, nameMap } = normalizeKiroToolSpecs([
      { name: "mcp__gitea__search_repos", description: "Search Gitea" },
    ]);
    expect(specs).toHaveLength(1);
    expect(specs[0].toolSpecification.name).toBe("mcp__gitea__search_repos");
    expect(nameMap.get("mcp__gitea__search_repos")).toBe("mcp__gitea__search_repos");
  });

  it("builds _toolNameMap for illegal characters and deduplicates colliding names", () => {
    const tools = [
      { name: "my.tool/search", description: "tool 1" },
      { name: "my_tool_search", description: "tool 2" },
    ];
    const openaiPayload = openaiToKiroRequest("claude-sonnet-4.6", {
      tools: tools.map((t) => ({ type: "function", function: t })),
      messages: [{ role: "user", content: "hello" }],
    }, true, {});

    expect(openaiPayload._toolNameMap).toBeInstanceOf(Map);
    // my.tool/search cleaned to my_tool_search. Since my_tool_search comes next, it becomes my_tool_search_2
    expect(openaiPayload._toolNameMap.get("my_tool_search")).toBe("my.tool/search");

    const claudePayload = claudeToKiroRequest("claude-sonnet-4.6", {
      tools,
      messages: [{ role: "user", content: "hello" }],
    }, true, {});

    expect(claudePayload._toolNameMap).toBeInstanceOf(Map);
    expect(claudePayload._toolNameMap.get("my_tool_search")).toBe("my.tool/search");
  });

  it("does not attach _toolNameMap when all tool names are legal and unchanged", () => {
    const tools = [
      { name: "mcp__gitea__search_repos", description: "Search Gitea" },
      { name: "bash_exec", description: "Run bash" },
    ];
    const payload = openaiToKiroRequest("claude-sonnet-4.6", {
      tools: tools.map((t) => ({ type: "function", function: t })),
      messages: [{ role: "user", content: "hello" }],
    }, true, {});

    expect(payload._toolNameMap).toBeUndefined();
  });

  it("restores original tool name in kiroToOpenAIResponse when state.toolNameMap is present", () => {
    const state = {
      toolNameMap: new Map([["my_tool_search", "my.tool/search"]]),
    };
    const event = {
      toolUseEvent: {
        toolUseId: "call_123",
        name: "my_tool_search",
        input: { q: "test" },
      },
    };
    const chunk = kiroToOpenAIResponse(event, state);
    expect(chunk).not.toBeNull();
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe("my.tool/search");
  });

  it("restores original tool name in kiroToClaudeResponse streaming when state.toolNameMap is present", () => {
    const state = {
      toolNameMap: new Map([["my_tool_search", "my.tool/search"]]),
      toolCalls: new Map(),
      nextBlockIndex: 0,
    };
    const chunk = {
      id: "chatcmpl-1",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_123",
            type: "function",
            function: { name: "my_tool_search", arguments: "" },
          }],
        },
      }],
    };
    const events = kiroToClaudeResponse(chunk, state);
    const startEvent = events.find((e) => e.type === "content_block_start");
    expect(startEvent).toBeDefined();
    expect(startEvent.content_block.name).toBe("my.tool/search");
  });

  it("restores original tool name in kiroToClaudeNonStreaming when toolNameMap is present", () => {
    const data = {
      choices: [{
        message: {
          tool_calls: [{
            id: "call_123",
            function: { name: "my_tool_search", arguments: "{}" },
          }],
        },
      }],
      toolNameMap: new Map([["my_tool_search", "my.tool/search"]]),
    };
    const result = kiroToClaudeNonStreaming(data);
    expect(result.content[0].name).toBe("my.tool/search");
  });
});
