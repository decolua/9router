import { register } from "../index.js";
import { FORMATS } from "../formats.js";

// Convert Antigravity SSE chunk to Claude format
// Antigravity format: {"response":{"candidates":[{"content":{"role":"model","parts":[...]}, "finishReason":"STOP"}], ...}}
export function antigravityToClaudeResponse(chunk, state) {
  if (!chunk?.response) return null;

  const results = [];
  const response = chunk.response;
  const candidate = response.candidates?.[0];
  
  if (!candidate) return null;

  // First chunk - send message_start
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = response.responseId?.replace(/^resp_/, "msg_") || `msg_${Date.now()}`;
    if (!state.messageId.startsWith("msg_")) {
      state.messageId = `msg_${state.messageId}`;
    }
    state.model = response.modelVersion || "gemini";
    state.nextBlockIndex = 0;

    const usage = response.usageMetadata || {};
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.promptTokenCount || 0,
          output_tokens: usage.candidatesTokenCount || 0
        }
      }
    });
  }

  const parts = candidate.content?.parts || [];
  
  for (const part of parts) {
    // Thinking/thought content
    if (part.thought && part.text) {
      if (!state.thinkingBlockStarted) {
        state.thinkingBlockIndex = state.nextBlockIndex++;
        state.thinkingBlockStarted = true;
        results.push({
          type: "content_block_start",
          index: state.thinkingBlockIndex,
          content_block: { type: "thinking", thinking: "" }
        });
      }
      results.push({
        type: "content_block_delta",
        index: state.thinkingBlockIndex,
        delta: { type: "thinking_delta", thinking: part.text }
      });
    }
    // Regular text content
    else if (part.text !== undefined) {
      if (state.thinkingBlockStarted) {
        results.push({
          type: "content_block_stop",
          index: state.thinkingBlockIndex
        });
        state.thinkingBlockStarted = false;
      }

      if (!state.textBlockStarted) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockStarted = true;
        results.push({
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" }
        });
      }
      
      if (part.text) {
        results.push({
          type: "content_block_delta",
          index: state.textBlockIndex,
          delta: { type: "text_delta", text: part.text }
        });
      }
    }
    // Function calls (tool use)
    else if (part.functionCall) {
      if (state.thinkingBlockStarted) {
        results.push({
          type: "content_block_stop",
          index: state.thinkingBlockIndex
        });
        state.thinkingBlockStarted = false;
      }
      if (state.textBlockStarted) {
        results.push({
          type: "content_block_stop",
          index: state.textBlockIndex
        });
        state.textBlockStarted = false;
      }

      const toolBlockIndex = state.nextBlockIndex++;
      const toolId = `toolu_${Date.now()}_${toolBlockIndex}`;
      
      results.push({
        type: "content_block_start",
        index: toolBlockIndex,
        content_block: {
          type: "tool_use",
          id: toolId,
          name: part.functionCall.name,
          input: part.functionCall.args || {}
        }
      });
      
      results.push({
        type: "content_block_stop",
        index: toolBlockIndex
      });
    }
  }

  // Handle finish
  if (candidate.finishReason) {
    if (state.thinkingBlockStarted) {
      results.push({
        type: "content_block_stop",
        index: state.thinkingBlockIndex
      });
      state.thinkingBlockStarted = false;
    }
    if (state.textBlockStarted) {
      results.push({
        type: "content_block_stop",
        index: state.textBlockIndex
      });
      state.textBlockStarted = false;
    }

    const usage = response.usageMetadata || {};
    const stopReason = convertFinishReason(candidate.finishReason);
    
    results.push({
      type: "message_delta",
      delta: { stop_reason: stopReason },
      usage: {
        input_tokens: usage.promptTokenCount || 0,
        output_tokens: usage.candidatesTokenCount || 0
      }
    });
    
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

// Convert Antigravity finish reason to Claude stop_reason
function convertFinishReason(reason) {
  switch (reason) {
    case "STOP": return "end_turn";
    case "MAX_TOKENS": return "max_tokens";
    case "SAFETY": return "end_turn";
    default: return "end_turn";
  }
}

// Register
register(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, antigravityToClaudeResponse);
