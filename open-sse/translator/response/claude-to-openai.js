import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";
import { encodeClaudeThinkingEnvelope } from "../concerns/claudeThinking.js";

// Create OpenAI chunk helper
function createChunk(state, delta, finishReason = null) {
  return buildChunk(
    { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model },
    delta,
    finishReason
  );
}

function startThinkingSpan(state, results) {
  if (!state.claudeThinkingSpanStarted) {
    state.claudeThinkingSpanStarted = true;
    results.push(createChunk(state, { content: "<think>" }));
  }
  state.claudeThinkingSpanPendingClose = false;
}

function closeThinkingSpan(state, results) {
  if (!state.claudeThinkingSpanStarted) return;
  const blocks = [...state.claudeThinkingBlocks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]) => block);
  const encrypted = encodeClaudeThinkingEnvelope(state.model, blocks);
  results.push(createChunk(state, {
    content: "</think>",
    ...(encrypted ? { reasoning_encrypted_content: encrypted } : {}),
  }));
  state.claudeThinkingBlocks.clear();
  state.claudeThinkingSpanStarted = false;
  state.claudeThinkingSpanPendingClose = false;
  state.inThinkingBlock = false;
  state.currentBlockIndex = null;
}

// Convert Claude stream chunk to OpenAI format
export function claudeToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  const results = [];
  const event = chunk.type;

  switch (event) {
    case "message_start": {
      state.messageId = chunk.message?.id || `msg_${Date.now()}`;
      state.model = chunk.message?.model;
      state.toolCallIndex = 0;
      state.claudeThinkingBlocks.clear();
      state.claudeThinkingSpanStarted = false;
      state.claudeThinkingSpanPendingClose = false;
      // Claude sends input_tokens + cache_read + cache_creation here; message_delta
      // later carries only the final output_tokens. Capture cache now so the
      // delta (output-only) doesn't reset it to zero.
      const startUsage = chunk.message?.usage;
      if (startUsage && typeof startUsage === "object") {
        const inputTokens = typeof startUsage.input_tokens === "number" ? startUsage.input_tokens : 0;
        const cacheReadTokens = typeof startUsage.cache_read_input_tokens === "number" ? startUsage.cache_read_input_tokens : 0;
        const cacheCreationTokens = typeof startUsage.cache_creation_input_tokens === "number" ? startUsage.cache_creation_input_tokens : 0;
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
        state.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: 0,
          total_tokens: promptTokens,
          input_tokens: inputTokens,
          output_tokens: 0
        };
        if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
        if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
      }
      results.push(createChunk(state, { role: ROLE.ASSISTANT }));
      break;
    }

    case "content_block_start": {
      const block = chunk.content_block;
      const isThinkingBlock = block?.type === CLAUDE_BLOCK.THINKING || block?.type === CLAUDE_BLOCK.REDACTED_THINKING;
      if (!isThinkingBlock && state.claudeThinkingSpanPendingClose) {
        closeThinkingSpan(state, results);
      }
      if (block?.type === "server_tool_use") {
        // Built-in tool (web search) - Claude handles internally, skip
        state.serverToolBlockIndex = chunk.index;
        break;
      }
      if (block?.type === CLAUDE_BLOCK.TEXT) {
        state.textBlockStarted = true;
      } else if (block?.type === CLAUDE_BLOCK.THINKING) {
        startThinkingSpan(state, results);
        state.inThinkingBlock = true;
        state.currentBlockIndex = chunk.index;
        state.claudeThinkingBlocks.set(chunk.index, {
          type: CLAUDE_BLOCK.THINKING,
          thinking: typeof block.thinking === "string" ? block.thinking : "",
          signature: typeof block.signature === "string" ? block.signature : "",
        });
      } else if (block?.type === CLAUDE_BLOCK.REDACTED_THINKING) {
        startThinkingSpan(state, results);
        state.inThinkingBlock = true;
        state.currentBlockIndex = chunk.index;
        state.claudeThinkingBlocks.set(chunk.index, {
          type: CLAUDE_BLOCK.REDACTED_THINKING,
          data: block.data,
        });
      } else if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
        const toolCallIndex = state.toolCallIndex++;
        // Restore original tool name from mapping (Claude OAuth)
        const toolName = state.toolNameMap?.get(block.name) || block.name;
        const toolCall = {
          index: toolCallIndex,
          id: block.id,
          type: OPENAI_BLOCK.FUNCTION,
          function: {
            name: toolName,
            arguments: ""
          }
        };
        state.toolCalls.set(chunk.index, toolCall);
        results.push(createChunk(state, { tool_calls: [toolCall] }));
      }
      break;
    }

    case "content_block_delta": {
      // Skip deltas for built-in server tool blocks (web search)
      if (chunk.index === state.serverToolBlockIndex) break;
      const delta = chunk.delta;
      if (delta?.type === "text_delta" && delta.text) {
        results.push(createChunk(state, { content: delta.text }));
      } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        const block = state.claudeThinkingBlocks.get(chunk.index);
        if (block?.type === CLAUDE_BLOCK.THINKING) block.thinking += delta.thinking;
        if (delta.thinking) results.push(createChunk(state, reasoningDelta(delta.thinking)));
      } else if (delta?.type === "signature_delta" && typeof delta.signature === "string") {
        const block = state.claudeThinkingBlocks.get(chunk.index);
        if (block?.type === CLAUDE_BLOCK.THINKING) block.signature += delta.signature;
      } else if (delta?.type === "input_json_delta" && delta.partial_json) {
        const toolCall = state.toolCalls.get(chunk.index);
        if (toolCall) {
          toolCall.function.arguments += delta.partial_json;
          results.push(createChunk(state, {
            tool_calls: [{
              index: toolCall.index,
              id: toolCall.id,
              function: { arguments: delta.partial_json }
            }]
          }));
        }
      }
      break;
    }

    case "content_block_stop": {
      // Skip stop for built-in server tool blocks (web search)
      if (chunk.index === state.serverToolBlockIndex) {
        state.serverToolBlockIndex = -1;
        break;
      }
      if (state.claudeThinkingBlocks.has(chunk.index)) {
        state.inThinkingBlock = false;
        state.currentBlockIndex = null;
        state.claudeThinkingSpanPendingClose = true;
      }
      state.textBlockStarted = false;
      state.thinkingBlockStarted = false;
      break;
    }

    case "message_delta": {
      if (state.claudeThinkingSpanPendingClose) closeThinkingSpan(state, results);
      // Extract usage from message_delta event (Claude native format).
      // Anthropic sends input/cache in message_start and only output here, so
      // fall back to cache captured in message_start when the delta omits it.
      if (chunk.usage && typeof chunk.usage === "object") {
        const prev = state.usage || {};
        const inputTokens = typeof chunk.usage.input_tokens === "number" ? chunk.usage.input_tokens : (prev.input_tokens || 0);
        const outputTokens = typeof chunk.usage.output_tokens === "number" ? chunk.usage.output_tokens : 0;
        const cacheReadTokens = typeof chunk.usage.cache_read_input_tokens === "number" ? chunk.usage.cache_read_input_tokens : (prev.cache_read_input_tokens || 0);
        const cacheCreationTokens = typeof chunk.usage.cache_creation_input_tokens === "number" ? chunk.usage.cache_creation_input_tokens : (prev.cache_creation_input_tokens || 0);

        // prompt_tokens = input_tokens + cache_read + cache_creation (all prompt-side tokens)
        const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

        state.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: outputTokens,
          total_tokens: promptTokens + outputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens
        };

        if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
        if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
      }

      if (chunk.delta?.stop_reason) {
        state.finishReason = convertStopReason(chunk.delta.stop_reason);
        const finalChunk = createChunk(state, {}, state.finishReason);

        if (state.usage) {
          // Build OpenAI usage from the merged state (cache from message_start +
          // output from message_delta), not the delta chunk alone.
          finalChunk.usage = toOpenAIUsage({
            input_tokens: state.usage.input_tokens || 0,
            output_tokens: state.usage.output_tokens || 0,
            cache_read_input_tokens: state.usage.cache_read_input_tokens,
            cache_creation_input_tokens: state.usage.cache_creation_input_tokens
          }, "claude");
        }

        results.push(finalChunk);
        state.finishReasonSent = true;
      }
      break;
    }

    case "message_stop": {
      if (state.claudeThinkingSpanPendingClose) closeThinkingSpan(state, results);
      if (!state.finishReasonSent) {
        const finishReason = state.finishReason || (state.toolCalls?.size > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP);
        const usageObj = (state.usage && typeof state.usage === 'object') ? {
          usage: {
            prompt_tokens: state.usage.input_tokens || 0,
            completion_tokens: state.usage.output_tokens || 0,
            total_tokens: (state.usage.input_tokens || 0) + (state.usage.output_tokens || 0)
          }
        } : {};
        results.push({ ...createChunk(state, {}, finishReason), ...usageObj });
        state.finishReasonSent = true;
      }
      break;
    }
  }

  return results.length > 0 ? results : null;
}

const convertStopReason = (reason) => toOpenAIFinish(reason, "claude");

// Register
register(FORMATS.CLAUDE, FORMATS.OPENAI, null, claudeToOpenAIResponse);
