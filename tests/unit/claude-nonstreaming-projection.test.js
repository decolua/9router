import { describe, it, expect } from "vitest";
import { openAICompletionToClaudeMessage, translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";
import { resolveModelAliasFromMap } from "../../open-sse/services/model.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { translateResponse } from "../../open-sse/translator/index.js";

describe("Claude non-streaming response projection & classifier compatibility", () => {
  it("projects OpenAI completion to official Anthropic Message format", () => {
    const openAICompletion = {
      id: "chatcmpl-safe-check-12345",
      object: "chat.completion",
      created: 1728000000,
      model: "claude-opus-5-5",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Safe to proceed.",
            reasoning_content: "Checking tool call parameters against safety invariants."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 15,
        total_tokens: 135
      }
    };

    const claudeMsg = openAICompletionToClaudeMessage(openAICompletion);

    // Official Anthropic Messages API spec checks
    expect(claudeMsg.type).toBe("message");
    expect(claudeMsg.role).toBe("assistant");
    expect(claudeMsg.id).toBe("msg_safe-check-12345");
    expect(claudeMsg.stop_reason).toBe("end_turn");
    expect(claudeMsg.stop_sequence).toBeNull();
    expect(claudeMsg.stop_details).toBeNull();

    // Content blocks
    expect(Array.isArray(claudeMsg.content)).toBe(true);
    const thinkingBlock = claudeMsg.content.find(b => b.type === "thinking");
    const textBlock = claudeMsg.content.find(b => b.type === "text");

    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe("Checking tool call parameters against safety invariants.");
    expect(thinkingBlock.signature).toBeTruthy();

    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe("Safe to proceed.");

    // Usage fields
    expect(claudeMsg.usage.input_tokens).toBe(120);
    expect(claudeMsg.usage.output_tokens).toBe(15);
  });

  it("handles tool_use and sets stop_reason to tool_use", () => {
    const openAICompletion = {
      id: "chatcmpl-tools-88888",
      model: "claude-opus-5",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_check_file_01",
                type: "function",
                function: {
                  name: "Read",
                  arguments: JSON.stringify({ file_path: "C:/test.js" })
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    };

    const claudeMsg = openAICompletionToClaudeMessage(openAICompletion);
    expect(claudeMsg.id).toBe("msg_tools-88888");
    expect(claudeMsg.stop_reason).toBe("tool_use");

    const toolUseBlock = claudeMsg.content.find(b => b.type === "tool_use");
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock.name).toBe("Read");
    expect(toolUseBlock.input).toEqual({ file_path: "C:/test.js" });
  });

  it("translates Gemini non-streaming response directly to Claude message when client is Claude", () => {
    const geminiResponse = {
      response: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { thought: true, text: "Evaluating risk level." },
                { text: "Command approved." }
              ]
            },
            finishReason: "STOP",
            index: 0
          }
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 10,
          totalTokenCount: 60
        },
        responseId: "gemini-eval-999"
      }
    };

    const translated = translateNonStreamingResponse(
      geminiResponse,
      FORMATS.GEMINI,
      FORMATS.CLAUDE
    );

    // Must be directly in Anthropic Messages shape, NOT OpenAI shape
    expect(translated.type).toBe("message");
    expect(translated.role).toBe("assistant");
    expect(translated.stop_reason).toBe("end_turn");
    expect(translated.id).toContain("msg_");
    expect(translated.content.some(b => b.type === "text" && b.text === "Command approved.")).toBe(true);
    expect(translated.content.some(b => b.type === "thinking" && b.thinking === "Evaluating risk level.")).toBe(true);
  });

  it("projects Gemini promptFeedback policy blocks to compliant Anthropic refusal Message", () => {
    const blockedResponse = {
      promptFeedback: {
        blockReason: "PROHIBITED_CONTENT",
        safetyRatings: [
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH" }
        ]
      }
    };

    const translated = translateNonStreamingResponse(
      blockedResponse,
      FORMATS.ANTIGRAVITY,
      FORMATS.CLAUDE
    );

    expect(translated.type).toBe("message");
    expect(translated.role).toBe("assistant");
    expect(translated.stop_reason).toBe("refusal");
    expect(translated.id).toContain("msg_");
    expect(translated.content[0].text).toContain("PROHIBITED_CONTENT");
    expect(translated.stop_details).toEqual({ type: "refusal", category: "general_harms" });
  });

  it("normalizes context suffix in model aliases and combo lookups", () => {
    const aliases = {
      "claude-opus-5-5": "ag/gemini-3.8-flash-high",
      "claude-sonnet-5": "ag/gemini-3.8-flash",
    };

    // Client requests model with [1m] or [200k] suffix
    const resolved1m = resolveModelAliasFromMap("claude-opus-5-5[1m]", aliases);
    expect(resolved1m).toEqual({
      provider: "antigravity",
      model: "gemini-3.8-flash-high"
    });

    const resolved200k = resolveModelAliasFromMap("claude-sonnet-5[200k]", aliases);
    expect(resolved200k).toEqual({
      provider: "antigravity",
      model: "gemini-3.8-flash"
    });
  });

  it("handles empty candidates non-streaming response without crashing with 'JSON but not a Message'", () => {
    const emptyGeminiResponse = {
      response: {
        candidates: [],
        usageMetadata: {
          promptTokenCount: 239010,
          candidatesTokenCount: 0,
          totalTokenCount: 239010
        },
        responseId: "gemini-truncated-retry-123"
      }
    };

    const translated = translateNonStreamingResponse(
      emptyGeminiResponse,
      FORMATS.ANTIGRAVITY,
      FORMATS.CLAUDE
    );

    // Guaranteed to be a valid Anthropic Message envelope
    expect(translated.type).toBe("message");
    expect(translated.role).toBe("assistant");
    expect(translated.id).toContain("msg_");
    expect(translated.stop_reason).toBe("end_turn");
    expect(Array.isArray(translated.content)).toBe(true);
    expect(translated.content[0]).toEqual({ type: "text", text: "" });
    expect(translated.usage.input_tokens).toBe(239010);
    expect(translated.usage.output_tokens).toBe(0);
  });

  it("synthesizes clean terminal message_stop when stream truncates prematurely before finish_reason", () => {
    const state = {
      messageStartSent: true,
      finishReason: null,
      usage: { input_tokens: 100, output_tokens: 0 }
    };

    // First, verify openaiToClaudeResponse flushes properly on null chunk
    const flushEvents = openaiToClaudeResponse(null, state);
    expect(Array.isArray(flushEvents)).toBe(true);
    expect(flushEvents.some(e => e.type === "message_delta" && e.delta.stop_reason === "end_turn")).toBe(true);
    expect(flushEvents.some(e => e.type === "message_stop")).toBe(true);

    // Second, verify translateResponse propagates null chunk through the 2-hop pipeline
    const streamState = {
      messageStartSent: true,
      finishReason: null,
      usage: { input_tokens: 150, output_tokens: 0 }
    };
    const pipelineFlush = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, streamState);
    expect(Array.isArray(pipelineFlush)).toBe(true);
    expect(pipelineFlush.some(e => e.type === "message_stop")).toBe(true);
  });
});
