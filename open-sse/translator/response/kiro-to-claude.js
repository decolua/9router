/**
 * Kiro → Claude Response Translator (DIRECT route, no OpenAI pivot)
 *
 * IMPORTANT: This translator does NOT receive raw Kiro AWS-EventStream frames.
 * KiroExecutor.transformEventStreamToSSE() (open-sse/executors/kiro.js) already
 * parses the binary EventStream and emits OpenAI-shaped
 * `chat.completion.chunk` objects. So the chunks arriving here are OpenAI
 * streaming chunks, and our job is OpenAI-chunk → Claude SSE events — the same
 * transformation openai-to-claude.js performs. We re-implement it here so the
 * direct `kiro:claude` route is self-contained and lossless (reasoning_content
 * → thinking blocks, tool_calls → tool_use blocks, usage → message_delta).
 *
 * Registered on the direct route by ../index.js; reached only when source
 * format is Claude and target is Kiro.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({ type: "content_block_stop", index: state.thinkingBlockIndex });
  state.thinkingBlockStarted = false;
}

function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({ type: "content_block_stop", index: state.textBlockIndex });
  state.textBlockStarted = false;
}

function convertFinishReason(reason) {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Convert one OpenAI-format chunk (from KiroExecutor) into Claude SSE events.
 * Returns an array of Claude events, or null when the chunk yields nothing.
 */
export function kiroToClaudeResponse(chunk, state) {
  // KiroExecutor emits chat.completion.chunk objects; tolerate string chunks
  // by attempting a parse (defensive — the direct path is always objects).
  let data = chunk;
  if (typeof chunk === "string") {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "[DONE]") return null;
    try {
      data = JSON.parse(trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed);
    } catch {
      return null;
    }
  }

  if (!data || !data.choices?.[0]) return null;

  const results = [];
  const choice = data.choices[0];
  const delta = choice.delta || {};

  // Track usage if present on the chunk.
  if (data.usage && typeof data.usage === "object") {
    const promptTokens =
      typeof data.usage.prompt_tokens === "number" ? data.usage.prompt_tokens : 0;
    const outputTokens =
      typeof data.usage.completion_tokens === "number"
        ? data.usage.completion_tokens
        : 0;
    state.usage = { input_tokens: promptTokens, output_tokens: outputTokens };
  }

  // First chunk → emit message_start.
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId =
      (typeof data.id === "string" && data.id.replace("chatcmpl-", "")) ||
      `msg_${Date.now()}`;
    state.model = data.model || "kiro";
    state.nextBlockIndex = 0;
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
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  // Reasoning / thinking content (Kiro reasoningContentEvent → reasoning_content).
  const reasoningContent = delta.reasoning_content || delta.reasoning;
  if (reasoningContent) {
    stopTextBlock(state, results);
    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: "thinking", thinking: "" },
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent },
    });
  }

  // Regular text content.
  if (delta.content) {
    stopThinkingBlock(state, results);
    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: "text", text: "" },
      });
    }
    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content },
    });
  }

  // Tool calls.
  if (delta.tool_calls) {
    if (!state.toolCalls) state.toolCalls = new Map();
    if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      if (tc.id) {
        stopThinkingBlock(state, results);
        stopTextBlock(state, results);
        const toolBlockIndex = state.nextBlockIndex++;
        state.toolCalls.set(idx, {
          id: tc.id,
          name: tc.function?.name || "",
          blockIndex: toolBlockIndex,
        });
        results.push({
          type: "content_block_start",
          index: toolBlockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name || "",
            input: {},
          },
        });
      }
      if (tc.function?.arguments) {
        const toolInfo = state.toolCalls.get(idx);
        if (toolInfo) {
          state.toolArgBuffers.set(
            idx,
            (state.toolArgBuffers.get(idx) || "") + tc.function.arguments
          );
        }
      }
    }
  }

  // Finish.
  if (choice.finish_reason) {
    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    if (state.toolCalls) {
      for (const [idx, toolInfo] of state.toolCalls) {
        const buffered = state.toolArgBuffers?.get(idx);
        if (buffered) {
          results.push({
            type: "content_block_delta",
            index: toolInfo.blockIndex,
            delta: { type: "input_json_delta", partial_json: buffered },
          });
        }
        results.push({ type: "content_block_stop", index: toolInfo.blockIndex });
      }
    }

    state.finishReason = choice.finish_reason;
    const finalUsage = state.usage || { input_tokens: 0, output_tokens: 0 };
    results.push({
      type: "message_delta",
      delta: { stop_reason: convertFinishReason(choice.finish_reason) },
      usage: finalUsage,
    });
    results.push({ type: "message_stop" });
  }

  return results.length > 0 ? results : null;
}

/**
 * Non-streaming Kiro → Claude. KiroExecutor only produces a stream, so this is
 * a defensive helper for any non-streaming caller that hands us an aggregated
 * OpenAI-shaped completion.
 */
export function kiroToClaudeNonStreaming(data) {
  const content = [];
  const choice = data?.choices?.[0];
  const message = choice?.message || {};

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input = {};
      try {
        input =
          typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {};
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function?.name || "",
        input,
      });
    }
  }

  const usage = data?.usage || {};
  return {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    content,
    model: data?.model || "kiro",
    stop_reason: convertFinishReason(choice?.finish_reason || "stop"),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
  };
}

register(FORMATS.KIRO, FORMATS.CLAUDE, null, kiroToClaudeResponse);
