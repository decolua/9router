/**
 * Translator response tests — claudeToOpenAIResponse, geminiToOpenAIResponse
 *
 * Covers:
 *  - Claude stream events → OpenAI chunk format
 *  - Stop reason mapping (end_turn → stop, tool_use → tool_calls)
 *  - Tool call name restoration from toolNameMap
 *  - Gemini response → OpenAI chunk format
 *  - Function call conversion in Gemini responses
 *  - Usage metadata extraction
 */

import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";

// Helper: create clean state for streaming
function createState() {
  return {
    messageId: null,
    model: null,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    inThinkingBlock: false,
    currentBlockIndex: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    contentBlockIndex: -1,
    toolCallIndex: 0,
    serverToolBlockIndex: -1,
  };
}

describe("claudeToOpenAIResponse", () => {
  describe("message_start event", () => {
    it("emits role: assistant chunk on message_start", () => {
      const state = createState();
      const chunk = {
        type: "message_start",
        message: { id: "msg_001", model: "claude-sonnet-4-6" },
      };
      const results = claudeToOpenAIResponse(chunk, state);

      expect(results).not.toBeNull();
      expect(results.length).toBe(1);
      expect(results[0].choices[0].delta.role).toBe("assistant");
      expect(results[0].id).toContain("chatcmpl-");
      expect(results[0].object).toBe("chat.completion.chunk");
    });

    it("initializes state from message_start", () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_002", model: "claude-opus-4-6" },
        },
        state
      );

      expect(state.messageId).toBe("msg_002");
      expect(state.model).toBe("claude-opus-4-6");
    });
  });

  describe("content_block_start + delta events", () => {
    it("emits text content from text_delta", () => {
      const state = createState();
      // Initialize state
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_003", model: "claude-sonnet-4-6" },
        },
        state
      );

      // Text block start
      claudeToOpenAIResponse(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        state
      );

      // Text delta
      const results = claudeToOpenAIResponse(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello world" },
        },
        state
      );

      expect(results).not.toBeNull();
      expect(results[0].choices[0].delta.content).toBe("Hello world");
    });

    it("emits thinking content from thinking_delta", () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_004", model: "claude-sonnet-4-6" },
        },
        state
      );

      // Thinking block start
      const startResults = claudeToOpenAIResponse(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking" },
        },
        state
      );

      // Should emit <think> tag
      expect(startResults).not.toBeNull();
      expect(startResults[0].choices[0].delta.content).toBe("<think>");

      // Thinking delta
      const results = claudeToOpenAIResponse(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me consider..." },
        },
        state
      );

      expect(results).not.toBeNull();
      expect(results[0].choices[0].delta.reasoning_content).toBe(
        "Let me consider..."
      );
    });
  });

  describe("tool_use events", () => {
    it("emits tool_calls delta on tool_use block start", () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_005", model: "claude-sonnet-4-6" },
        },
        state
      );

      const results = claudeToOpenAIResponse(
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_001",
            name: "get_weather",
          },
        },
        state
      );

      expect(results).not.toBeNull();
      expect(results[0].choices[0].delta.tool_calls).toBeDefined();
      expect(results[0].choices[0].delta.tool_calls[0].function.name).toBe(
        "get_weather"
      );
      expect(results[0].choices[0].delta.tool_calls[0].id).toBe("toolu_001");
      expect(results[0].choices[0].delta.tool_calls[0].type).toBe("function");
    });

    it("restores original tool name from toolNameMap", () => {
      const state = createState();
      state.toolNameMap = new Map([["prefixed_get_weather", "get_weather"]]);

      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_006", model: "claude-sonnet-4-6" },
        },
        state
      );

      const results = claudeToOpenAIResponse(
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_002",
            name: "prefixed_get_weather",
          },
        },
        state
      );

      expect(results[0].choices[0].delta.tool_calls[0].function.name).toBe(
        "get_weather"
      );
    });

    it("accumulates tool arguments from input_json_delta", () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_007", model: "claude-sonnet-4-6" },
        },
        state
      );

      // Start tool block
      claudeToOpenAIResponse(
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_003",
            name: "search",
          },
        },
        state
      );

      // First arg delta
      const r1 = claudeToOpenAIResponse(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"query":' },
        },
        state
      );

      expect(r1).not.toBeNull();
      expect(r1[0].choices[0].delta.tool_calls[0].function.arguments).toBe(
        '{"query":'
      );

      // Second arg delta
      claudeToOpenAIResponse(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '"test"}' },
        },
        state
      );

      // Check accumulated arguments on state
      const toolCall = state.toolCalls.get(0);
      expect(toolCall.function.arguments).toBe('{"query":"test"}');
    });
  });

  describe("stop reason mapping", () => {
    it('maps end_turn to "stop"', () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_008", model: "claude-sonnet-4-6" },
        },
        state
      );

      const results = claudeToOpenAIResponse(
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 50 },
        },
        state
      );

      expect(results).not.toBeNull();
      const finalChunk = results[results.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("stop");
    });

    it('maps tool_use to "tool_calls"', () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_009", model: "claude-sonnet-4-6" },
        },
        state
      );

      const results = claudeToOpenAIResponse(
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { output_tokens: 30 },
        },
        state
      );

      const finalChunk = results[results.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
    });

    it('maps max_tokens to "length"', () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_010", model: "claude-sonnet-4-6" },
        },
        state
      );

      const results = claudeToOpenAIResponse(
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 4096 },
        },
        state
      );

      const finalChunk = results[results.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("length");
    });
  });

  describe("usage extraction", () => {
    it("extracts usage from message_delta", () => {
      const state = createState();
      claudeToOpenAIResponse(
        {
          type: "message_start",
          message: { id: "msg_011", model: "claude-sonnet-4-6" },
        },
        state
      );

      claudeToOpenAIResponse(
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
          },
        },
        state
      );

      expect(state.usage).toBeDefined();
      expect(state.usage.input_tokens).toBe(100);
      expect(state.usage.output_tokens).toBe(50);
      expect(state.usage.cache_read_input_tokens).toBe(20);
    });
  });

  describe("null handling", () => {
    it("returns null for null chunk", () => {
      const state = createState();
      expect(claudeToOpenAIResponse(null, state)).toBeNull();
    });

    it("returns null for unknown event type", () => {
      const state = createState();
      const result = claudeToOpenAIResponse(
        { type: "unknown_event" },
        state
      );
      expect(result).toBeNull();
    });
  });
});

describe("geminiToOpenAIResponse", () => {
  describe("basic text response", () => {
    it("emits role: assistant then text content", () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello from Gemini" }],
            },
          },
        ],
        responseId: "resp_001",
        modelVersion: "gemini-3-flash",
      };

      const results = geminiToOpenAIResponse(chunk, state);

      expect(results).not.toBeNull();
      // Should have role chunk + text chunk
      expect(results.length).toBe(2);
      expect(results[0].choices[0].delta.role).toBe("assistant");
      expect(results[1].choices[0].delta.content).toBe("Hello from Gemini");
    });
  });

  describe("function call response", () => {
    it("converts functionCall to tool_calls format", () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "get_weather",
                    args: { city: "NYC" },
                  },
                },
              ],
            },
          },
        ],
        responseId: "resp_002",
        modelVersion: "gemini-3-flash",
      };

      const results = geminiToOpenAIResponse(chunk, state);

      expect(results).not.toBeNull();
      // Role chunk + tool_calls chunk
      const toolChunk = results.find(
        (r) => r.choices[0].delta.tool_calls
      );
      expect(toolChunk).toBeDefined();
      expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe(
        "get_weather"
      );
      expect(toolChunk.choices[0].delta.tool_calls[0].function.arguments).toBe(
        '{"city":"NYC"}'
      );
      expect(toolChunk.choices[0].delta.tool_calls[0].type).toBe("function");
    });
  });

  describe("finish reason", () => {
    it('converts STOP to "stop"', () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: { parts: [{ text: "done" }] },
            finishReason: "STOP",
          },
        ],
        responseId: "resp_003",
        modelVersion: "gemini-3-flash",
      };

      const results = geminiToOpenAIResponse(chunk, state);

      const finalChunk = results[results.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("stop");
    });

    it('converts STOP to "tool_calls" when tool calls are present', () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "search",
                    args: { q: "test" },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        responseId: "resp_004",
        modelVersion: "gemini-3-flash",
      };

      const results = geminiToOpenAIResponse(chunk, state);

      const finalChunk = results[results.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
    });
  });

  describe("usage metadata", () => {
    it("extracts usage from usageMetadata", () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: { parts: [{ text: "hi" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
          thoughtsTokenCount: 0,
        },
        responseId: "resp_005",
        modelVersion: "gemini-3-flash",
      };

      geminiToOpenAIResponse(chunk, state);

      expect(state.usage).toBeDefined();
      expect(state.usage.prompt_tokens).toBe(100);
      expect(state.usage.completion_tokens).toBe(50);
      expect(state.usage.total_tokens).toBe(150);
    });

    it("includes reasoning tokens in completion_tokens_details", () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        candidates: [
          {
            content: { parts: [{ text: "hi" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 30,
          totalTokenCount: 180,
          thoughtsTokenCount: 50,
        },
        responseId: "resp_006",
        modelVersion: "gemini-3-flash",
      };

      geminiToOpenAIResponse(chunk, state);

      expect(state.usage.completion_tokens).toBe(80); // 30 + 50
      expect(state.usage.completion_tokens_details.reasoning_tokens).toBe(50);
    });
  });

  describe("Antigravity wrapper handling", () => {
    it("unwraps response field from Antigravity envelope", () => {
      const state = createState();
      state.functionIndex = 0;

      const chunk = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Antigravity response" }] },
            },
          ],
          responseId: "resp_007",
          modelVersion: "gemini-3-flash",
        },
      };

      const results = geminiToOpenAIResponse(chunk, state);

      expect(results).not.toBeNull();
      const textChunk = results.find(
        (r) => r.choices[0].delta.content
      );
      expect(textChunk.choices[0].delta.content).toBe("Antigravity response");
    });
  });

  describe("null handling", () => {
    it("returns null for null chunk", () => {
      const state = createState();
      expect(geminiToOpenAIResponse(null, state)).toBeNull();
    });

    it("returns null for chunk without candidates", () => {
      const state = createState();
      expect(geminiToOpenAIResponse({}, state)).toBeNull();
    });
  });
});
