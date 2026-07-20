/**
 * Unit tests for open-sse/translator/request/openai-to-kiro.js
 *
 * Tests cover:
 *  - openaiToKiroRequest() - basic message conversion
 *  - Image forwarding fix: images in currentMessage must be included in payload
 */

import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const contentOf = (result) =>
  result.conversationState.currentMessage.userInputMessage.content;
const systemPromptOf = (result) => result.systemPrompt || "";

describe("openaiToKiroRequest", () => {
  describe("basic message conversion", () => {
    it("should convert a simple text message", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("Hello");
      expect(currentMsg.userInputMessage.modelId).toBe("claude-sonnet-4.6");
      expect(currentMsg.userInputMessage.origin).toBe("AI_EDITOR");
    });

    it("should not include images field when no images are present", () => {
      const body = {
        messages: [{ role: "user", content: "No images here" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });
  });

  describe("image forwarding", () => {
    it("should forward base64 image from image_url content part", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeDefined();
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
      expect(currentMsg.userInputMessage.images[0].format).toBe("png");
      expect(currentMsg.userInputMessage.images[0].source.bytes).toBe(fakeBase64);
    });

    it("should forward multiple base64 images", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Compare these images" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fakeBase64}` } },
              { type: "image_url", image_url: { url: `data:image/png;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toHaveLength(2);
      expect(currentMsg.userInputMessage.images[0].format).toBe("jpeg");
      expect(currentMsg.userInputMessage.images[1].format).toBe("png");
    });

    it("should not include images field when images array is empty", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Just text" }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.images).toBeUndefined();
    });

    it("should include both images and text content together", () => {
      const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fakeBase64}` } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      expect(currentMsg.userInputMessage.content).toContain("What is in this image?");
      expect(currentMsg.userInputMessage.images).toHaveLength(1);
    });

    it("should treat http image URLs as text fallback (Kiro only supports base64)", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this" },
              { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      const currentMsg = result.conversationState.currentMessage;
      // HTTP URLs are not supported by Kiro — converted to text placeholder
      expect(currentMsg.userInputMessage.images).toBeUndefined();
      expect(currentMsg.userInputMessage.content).toContain("[Image: https://example.com/photo.jpg]");
    });
  });

  describe("tool interaction without client-provided tools", () => {
    // When the client omits `tools` (e.g. after compaction), structured tool
    // content must be flattened to text so Kiro's "tools required" 400 never
    // fires and no phantom tool-calling capability is advertised.

    it("should flatten OpenAI tool_calls + tool result into history text with no tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }
            ]
          },
          { role: "tool", tool_call_id: "call_1", content: "file contents here" },
          { role: "user", content: "Summarize it" }
        ]
        // note: no `tools`
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      // No structured tool content anywhere
      expect(cs.currentMessage.userInputMessage.userInputMessageContext).toBeUndefined();
      const allJson = JSON.stringify(cs);
      expect(allJson).not.toContain("toolUses");
      expect(allJson).not.toContain("toolResults");

      // Tool call + result preserved as readable text (call lands in history,
      // result merges into the final currentMessage — assert across both)
      expect(allJson).toContain("[Tool call: read_file(");
      expect(allJson).toContain("[Tool result: file contents here]");
    });

    it("should flatten Claude tool_use / tool_result blocks with no tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Do it" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Calling tool" },
              { type: "tool_use", id: "tu_1", name: "search", input: { q: "kiro" } }
            ]
          },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tu_1", content: "result text" }
            ]
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      const allJson = JSON.stringify(cs);
      expect(allJson).not.toContain("toolUses");
      expect(allJson).not.toContain("toolResults");
      expect(allJson).toContain("[Tool call: search(");
      expect(allJson).toContain("[Tool result: result text]");
    });

    it("should keep structured tools when the client DOES provide a tools array", () => {
      const body = {
        messages: [
          { role: "user", content: "Read the file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }
            ]
          },
          { role: "tool", tool_call_id: "call_1", content: "file contents here" },
          { role: "user", content: "Summarize it" }
        ],
        tools: [
          {
            type: "function",
            function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;

      // Structured tool spec carried on currentMessage
      const tools = cs.currentMessage.userInputMessage.userInputMessageContext?.tools;
      expect(tools).toBeDefined();
      expect(tools[0].toolSpecification.name).toBe("read_file");

      // Structured tool history preserved (not flattened to text)
      const allJson = JSON.stringify(cs);
      expect(allJson).toContain("toolUses");
      expect(allJson).not.toContain("[Tool call:");
    });

    it("should salvage orphaned tool_result content as text instead of discarding it", () => {
      // Client provides tools, but compaction removed the assistant tool_use
      // message, leaving a tool_result whose tool_use_id matches nothing.
      const body = {
        messages: [
          { role: "user", content: "Start" },
          // (assistant tool_use for "orphan_call" was compacted away)
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "orphan_call", content: "important orphaned output" }
            ]
          },
          { role: "user", content: "Now continue" }
        ],
        tools: [
          {
            type: "function",
            function: { name: "some_tool", description: "x", parameters: { type: "object", properties: {}, required: [] } }
          }
        ]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});
      const cs = result.conversationState;
      const allJson = JSON.stringify(cs);

      // The dangling structured reference is gone (would trigger Kiro 400)...
      expect(allJson).not.toContain("orphan_call");
      // ...but the content is preserved as salvaged text, not discarded.
      expect(allJson).toContain("[Tool result: important orphaned output]");
    });
  });

  describe("thinking budget", () => {
    it("maps reasoning_effort low to max_thinking_length 1024", () => {
      const body = {
        reasoning_effort: "low",
        messages: [{ role: "user", content: "Think lightly" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>1024</max_thinking_length>");
      expect(result.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "low" },
      });
    });

    it("maps reasoning_effort high to max_thinking_length 24576", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Think deeply" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
      });
    });

    it("does not send additionalModelRequestFields for legacy Kiro model ids", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Legacy model id should not get adaptive fields" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.5", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("does not send additionalModelRequestFields for date-suffixed Claude 4 model ids", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Date-suffixed Claude 4 should stay legacy" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4-20250514", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("does not send additionalModelRequestFields for pre-4 legacy Kiro model ids", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Older model id should not get adaptive fields" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-3.7", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("does not send additionalModelRequestFields for prefixed pre-4 legacy Kiro model ids", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Prefixed older model id should not get adaptive fields" }]
      };

      const result = openaiToKiroRequest("kiro/claude-3-7-sonnet-20250219", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("does not send Claude-specific additionalModelRequestFields for prefixed non-Claude aliases", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Prefixed non-Claude alias should not get adaptive fields" }]
      };

      const result = openaiToKiroRequest("kiro/gpt-4o", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("does not send Claude-specific additionalModelRequestFields for non-Claude aliases", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Non-Claude aliases should not get Claude adaptive fields" }]
      };

      const result = openaiToKiroRequest("gpt-4o", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>24576</max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });

    it("defaults future Kiro model ids to additionalModelRequestFields support", () => {
      const body = {
        reasoning_effort: "high",
        messages: [{ role: "user", content: "Future model id should get adaptive fields" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.60", body, true, {});

      expect(result.additionalModelRequestFields).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
      });
    });

    it("clamps reasoning_effort max to Kiro max_thinking_length 32000", () => {
      const body = {
        reasoning_effort: "max",
        messages: [{ role: "user", content: "Think as much as possible" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>32000</max_thinking_length>");
      expect(result.additionalModelRequestFields?.output_config?.effort).toBe("high");
    });

    it("clamps OpenAI Responses reasoning.effort xhigh to max_thinking_length 32000", () => {
      const body = {
        reasoning: { effort: "xhigh" },
        messages: [{ role: "user", content: "Think extra deeply" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>32000</max_thinking_length>");
      expect(result.additionalModelRequestFields?.output_config?.effort).toBe("high");
    });

    it("uses Claude thinking.budget_tokens as max_thinking_length", () => {
      const body = {
        thinking: { type: "enabled", budget_tokens: 4096 },
        messages: [{ role: "user", content: "Use a fixed budget" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>4096</max_thinking_length>");
    });

    it("uses the default budget for synthetic -thinking models with no explicit config", () => {
      const body = {
        messages: [{ role: "user", content: "Think by model suffix" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6-thinking", body, true, {});

      expect(systemPromptOf(result)).toContain("<max_thinking_length>16000</max_thinking_length>");
    });

    it("keeps top-level systemPrompt stable across turns", () => {
      const first = openaiToKiroRequest(
        "claude-sonnet-4.6-thinking",
        { messages: [{ role: "user", content: "first" }] },
        true,
        {}
      );
      const second = openaiToKiroRequest(
        "claude-sonnet-4.6-thinking",
        { messages: [{ role: "user", content: "second" }] },
        true,
        {}
      );

      expect(first.systemPrompt).toBe(second.systemPrompt);
      expect(first.systemPrompt).not.toContain("Current time");
      expect(first.conversationState.currentMessage.userInputMessage.content).toContain("Current time");
    });

    it("replays frozen msg0 for explicit Kiro sessions while keeping current time fresh", () => {
      const credentials = {
        connectionId: "kiro-account-openai-replay",
        rawHeaders: { "x-session-id": "hermes-session-openai-replay" },
      };
      const first = openaiToKiroRequest(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "first turn" }] },
        true,
        credentials
      );
      const second = openaiToKiroRequest(
        "claude-sonnet-4.6",
        { messages: [{ role: "user", content: "second turn" }] },
        true,
        credentials
      );

      expect(second.conversationState.conversationId).toBe("hermes-session-openai-replay");
      expect(second.conversationState.agentContinuationId).toBe(first.conversationState.agentContinuationId);
      expect(second.conversationState.history[0].userInputMessage.content).toBe(
        first.conversationState.currentMessage.userInputMessage.content
      );
      expect(second.conversationState.history[0].userInputMessage.modelId).toBe("claude-sonnet-4.6");
      expect(second.conversationState.currentMessage.userInputMessage.content).toContain("Current time");
      expect(second.conversationState.currentMessage.userInputMessage.content).toContain("second turn");
    });

    it("does not inject thinking prefix for reasoning_effort none", () => {
      const body = {
        reasoning_effort: "none",
        messages: [{ role: "user", content: "Do not think" }]
      };

      const result = openaiToKiroRequest("claude-sonnet-4.6", body, true, {});

      expect(systemPromptOf(result)).not.toContain("<thinking_mode>enabled</thinking_mode>");
      expect(systemPromptOf(result)).not.toContain("<max_thinking_length>");
      expect(result.additionalModelRequestFields).toBeUndefined();
    });
  });
});
