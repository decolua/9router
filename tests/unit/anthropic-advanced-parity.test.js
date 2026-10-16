import { describe, it, expect } from "vitest";
import { openaiToClaudeResponse } from "open-sse/translator/response/openai-to-claude.js";
import { openAICompletionToClaudeMessage } from "open-sse/translator/concerns/claudeMessage.js";
import { formatSSE } from "open-sse/utils/streamHelpers.js";
import { FORMATS } from "open-sse/translator/formats.js";

describe("Anthropic Advanced Parity - Thinking Display & Spec Alignment", () => {
  it("streaming: suppresses reasoning text when thinking.display is 'omitted'", () => {
    const state = {
      thinkingDisplay: "omitted",
      toolCalls: new Map(),
      nextBlockIndex: 0,
      thinkingBlockStarted: false,
      textBlockStarted: false,
      messageStartSent: false,
    };

    // 1. First chunk with reasoning
    const chunk1 = {
      id: "chatcmpl-test12345",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "This is private internal reasoning that should be omitted",
            thought_signature: "sig_abc_123"
          }
        }
      ]
    };
    const events1 = openaiToClaudeResponse(chunk1, state);
    expect(events1).toBeDefined();

    // message_start should have msg_ prefix
    const msgStart = events1.find(e => e.type === "message_start");
    expect(msgStart).toBeDefined();
    expect(msgStart.message.id).toBe("msg_test12345");

    // thinking block start should be present
    const blockStart = events1.find(e => e.type === "content_block_start" && e.content_block?.type === "thinking");
    expect(blockStart).toBeDefined();
    expect(blockStart.content_block.thinking).toBe("");
    expect(blockStart.content_block.signature).toBe("");

    // thinking delta should be EMPTY string, not leaking reasoning text
    const thinkingDeltas = events1.filter(e => e.type === "content_block_delta" && e.delta?.type === "thinking_delta");
    expect(thinkingDeltas.length).toBeGreaterThan(0);
    for (const d of thinkingDeltas) {
      expect(d.delta.thinking).toBe("");
    }

    // 2. Second chunk with more reasoning (should be completely omitted)
    const chunk2 = {
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "More internal thoughts that should not be visible",
          }
        }
      ]
    };
    const events2 = openaiToClaudeResponse(chunk2, state);
    // Should NOT emit thinking delta with text
    const textDeltas2 = (events2 || []).filter(e => e.type === "content_block_delta" && e.delta?.type === "thinking_delta");
    expect(textDeltas2.length).toBe(0);

    // 3. Third chunk with text content
    const chunk3 = {
      choices: [
        {
          index: 0,
          delta: {
            content: "Public response text",
          }
        }
      ]
    };
    const events3 = openaiToClaudeResponse(chunk3, state);
    // Thinking block should be closed with signature_delta
    const sigDelta = events3.find(e => e.type === "content_block_delta" && e.delta?.type === "signature_delta");
    expect(sigDelta).toBeDefined();
    expect(sigDelta.delta.signature).toBe("sig_abc_123");

    const blockStop = events3.find(e => e.type === "content_block_stop" && e.index === 0);
    expect(blockStop).toBeDefined();

    // Text block should start
    const textStart = events3.find(e => e.type === "content_block_start" && e.content_block?.type === "text");
    expect(textStart).toBeDefined();

    // 4. Finish chunk
    const chunk4 = {
      choices: [
        {
          index: 0,
          finish_reason: "stop"
        }
      ]
    };
    const events4 = openaiToClaudeResponse(chunk4, state);
    const msgDelta = events4.find(e => e.type === "message_delta");
    expect(msgDelta).toBeDefined();
    expect(msgDelta.delta.stop_reason).toBe("end_turn");
    expect(msgDelta.delta.stop_sequence).toBeNull();
  });

  it("non-streaming: sets thinking to empty string when thinking.display is 'omitted'", () => {
    const raw = {
      id: "chatcmpl-testnonstream999",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello there!",
            reasoning_content: "Secret chain of thought...",
            thought_signature: "sig_nonstream_123"
          },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 }
    };

    const res = openAICompletionToClaudeMessage(raw, { thinkingDisplay: "omitted" });
    expect(res.id).toBe("msg_testnonstream999");
    expect(res.type).toBe("message");
    expect(res.role).toBe("assistant");
    expect(res.stop_reason).toBe("end_turn");
    expect(res.stop_sequence).toBeNull();

    // Content blocks
    const thinkingBlock = res.content.find(c => c.type === "thinking");
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe("");
    expect(thinkingBlock.signature).toBe("sig_nonstream_123");

    const textBlock = res.content.find(c => c.type === "text");
    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe("Hello there!");
  });

  it("streaming: sets stop_reason to 'tool_use' when tool calls were made", () => {
    const state = {
      toolCalls: new Map(),
      nextBlockIndex: 0,
      thinkingBlockStarted: false,
      textBlockStarted: false,
      messageStartSent: false,
    };

    // 1. Tool call chunk
    openaiToClaudeResponse({
      id: "chatcmpl-tool12345",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "toolu_abc_1",
                function: { name: "get_weather", arguments: '{"city":' }
              }
            ]
          }
        }
      ]
    }, state);

    // 2. Arg delta
    openaiToClaudeResponse({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: '"Tokyo"}' }
              }
            ]
          }
        }
      ]
    }, state);

    // 3. Finish
    const finishEvents = openaiToClaudeResponse({
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls"
        }
      ]
    }, state);

    const msgDelta = finishEvents.find(e => e.type === "message_delta");
    expect(msgDelta).toBeDefined();
    expect(msgDelta.delta.stop_reason).toBe("tool_use");
    expect(msgDelta.delta.stop_sequence).toBeNull();
  });

  it("formats SSE ping event according to official Anthropic spec", () => {
    const formatted = formatSSE({ type: "ping" }, FORMATS.CLAUDE);
    expect(formatted).toBe("event: ping\ndata: {\"type\":\"ping\"}\n\n");
  });
});
