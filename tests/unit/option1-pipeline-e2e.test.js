import { describe, it, expect } from "vitest";
import { CLAUDE_BLOCK } from "../../open-sse/translator/schema/blocks.js";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

describe("Option 1 Full Pipeline End-to-End Test", () => {
  const sampleGroundingMetadata = {
    webSearchQueries: ["Nobel Prize in Physics 2024 winners"],
    groundingChunks: [
      {
        web: {
          uri: "https://www.nobelprize.org/prizes/physics/2024/summary/",
          title: "The Nobel Prize in Physics 2024",
        },
      },
      {
        web: {
          uri: "https://en.wikipedia.org/wiki/List_of_Nobel_laureates_in_Physics",
          title: "List of Nobel laureates in Physics - Wikipedia",
        },
      },
    ],
  };

  it("translates Claude native web_search tool through OpenAI to Gemini { googleSearch: {} }", () => {
    const claudeReq = {
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "Who won the physics nobel in 2024?" }],
      tools: [
        { type: "web_search_20250305", name: "web_search" },
        {
          name: "calculate",
          description: "Do math",
          input_schema: { type: "object", properties: { expr: { type: "string" } } },
        },
      ],
    };

    // 1. Claude -> OpenAI
    const openAIReq = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gemini-2.5-flash", claudeReq);
    expect(openAIReq.tools).toBeDefined();
    const searchTool = openAIReq.tools.find((t) => t.type === "web_search" || t.name === "web_search");
    expect(searchTool).toBeDefined();

    // 2. OpenAI -> Gemini
    const geminiReq = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.5-flash", openAIReq);
    expect(geminiReq.tools).toBeDefined();
    expect(geminiReq.tools.some((g) => g.googleSearch !== undefined)).toBe(true);
    expect(geminiReq.tools.some((g) => g.functionDeclarations?.length > 0)).toBe(true);
  });

  it("streams Gemini groundingMetadata through OpenAI into compliant Anthropic server tool events", () => {
    // 1. Gemini chunk with candidate and groundingMetadata
    const geminiChunk = {
      responseId: "resp_123456",
      candidates: [
        {
          content: {
            parts: [{ text: "John Hopfield and Geoffrey Hinton won the 2024 Nobel Prize." }],
          },
          groundingMetadata: sampleGroundingMetadata,
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30, totalTokenCount: 80 },
    };

    const geminiState = { ...initState(FORMATS.GEMINI), model: "gemini-2.5-flash" };
    const openAIChunks = translateResponse(FORMATS.GEMINI, FORMATS.OPENAI, geminiChunk, geminiState);
    expect(openAIChunks).toBeDefined();
    expect(Array.isArray(openAIChunks)).toBe(true);

    const hasGrounding = openAIChunks.some((c) => c.groundingMetadata);
    expect(hasGrounding).toBe(true);

    // 2. OpenAI chunks -> Claude SSE events
    const claudeState = {
      ...initState(FORMATS.CLAUDE),
      body: { tools: [{ type: "web_search_20250305", name: "web_search" }] },
    };

    const allClaudeEvents = [];
    for (const chunk of openAIChunks) {
      const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk, claudeState);
      if (events) allClaudeEvents.push(...events);
    }

    const types = allClaudeEvents.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    expect(types).toContain("content_block_stop");
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");

    // Inspect blocks
    const blockStarts = allClaudeEvents.filter((e) => e.type === "content_block_start");
    expect(blockStarts.length).toBeGreaterThanOrEqual(3);

    // Block 0: server_tool_use
    expect(blockStarts[0].index).toBe(0);
    expect(blockStarts[0].content_block.type).toBe(CLAUDE_BLOCK.SERVER_TOOL_USE);
    expect(blockStarts[0].content_block.name).toBe("web_search");
    expect(CLAUDE_SERVER_TOOL_USE_ID.test(blockStarts[0].content_block.id)).toBe(true);

    // Block 1: web_search_tool_result
    expect(blockStarts[1].index).toBe(1);
    expect(blockStarts[1].content_block.type).toBe(CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT);
    expect(blockStarts[1].content_block.tool_use_id).toBe(blockStarts[0].content_block.id);
    expect(blockStarts[1].content_block.content).toHaveLength(2);

    // Block 2: text
    expect(blockStarts[2].index).toBe(2);
    expect(blockStarts[2].content_block.type).toBe(CLAUDE_BLOCK.TEXT);

    // Verify usage carries server_tool_use
    const msgDelta = allClaudeEvents.find((e) => e.type === "message_delta");
    expect(msgDelta.usage.server_tool_use).toBeDefined();
    expect(msgDelta.usage.server_tool_use.web_search_requests).toBe(1);
  });

  it("handles multi-turn round trip when Claude sends server_tool_use and web_search_tool_result in history", () => {
    const serverToolId = "srvtoolu_9router_test_123";
    const claudeTurn2 = {
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "Who won the physics nobel?" },
        {
          role: "assistant",
          content: [
            {
              type: "server_tool_use",
              id: serverToolId,
              name: "web_search",
              input: { query: "Nobel Prize Physics 2024" },
            },
            {
              type: "web_search_tool_result",
              tool_use_id: serverToolId,
              content: [
                {
                  type: "web_search_result",
                  url: "https://www.nobelprize.org",
                  title: "Nobel Prize",
                  encrypted_content: "YWJj",
                },
              ],
            },
            {
              type: "text",
              text: "Hopfield and Hinton won.",
            },
          ],
        },
        { role: "user", content: "What was Hinton's contribution?" },
      ],
    };

    // 1. Normalize passthrough should not strip server blocks
    const normalized = normalizeClaudePassthrough(claudeTurn2, "claude-sonnet-5");
    expect(normalized.messages[1].content).toHaveLength(3);

    // 2. Claude -> OpenAI translation should generate assistant tool call and tool response
    const openAIReq = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "gemini-2.5-flash", claudeTurn2);
    expect(openAIReq.messages.length).toBeGreaterThanOrEqual(4);

    const asstCallMsg = openAIReq.messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(asstCallMsg).toBeDefined();
    expect(asstCallMsg.tool_calls[0].id).toBe(serverToolId);

    const toolResultMsg = openAIReq.messages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.tool_call_id).toBe(serverToolId);

    const asstTextMsg = openAIReq.messages.find((m) => m.role === "assistant" && typeof m.content === "string");
    expect(asstTextMsg).toBeDefined();
    expect(asstTextMsg.content).toBe("Hopfield and Hinton won.");
  });
});
