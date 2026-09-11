import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

// Create OpenAI chunk helper
function createChunk(state, delta, finishReason = null) {
  return buildChunk(
    { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model },
    delta,
    finishReason
  );
}

// Record Anthropic usage on the translator state in the canonical OpenAI
// convention: prompt_tokens is cache-INCLUSIVE and the cache split rides in
// cached_tokens / prompt_tokens_details. stream.js re-emits state.usage to the
// client through filterUsageForFormat() (which keeps only OpenAI field names)
// and hands it to canonicalizeUsage() for logging (which folds cache into the
// prompt only when cached_tokens is absent). Keeping the raw Claude-exclusive
// split here without cached_tokens dropped the cache from the client's final
// chunk and double-counted the prompt in usage logs.
function setUsageState(state, { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }) {
  state.usage = {
    ...toOpenAIUsage({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens
    }, "claude"),
    cached_tokens: cacheReadTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens
  };
  if (cacheReadTokens > 0) state.usage.cache_read_input_tokens = cacheReadTokens;
  if (cacheCreationTokens > 0) state.usage.cache_creation_input_tokens = cacheCreationTokens;
}

// The OpenAI-facing subset of state.usage (drops the Claude-native mirror fields).
function clientUsage(usage) {
  const { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details } = usage;
  return { prompt_tokens, completion_tokens, total_tokens, ...(prompt_tokens_details ? { prompt_tokens_details } : {}) };
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
      // Claude sends input_tokens + cache_read + cache_creation here; message_delta
      // later carries only the final output_tokens. Capture cache now so the
      // delta (output-only) doesn't reset it to zero.
      const startUsage = chunk.message?.usage;
      if (startUsage && typeof startUsage === "object") {
        setUsageState(state, {
          inputTokens: typeof startUsage.input_tokens === "number" ? startUsage.input_tokens : 0,
          outputTokens: 0,
          cacheReadTokens: typeof startUsage.cache_read_input_tokens === "number" ? startUsage.cache_read_input_tokens : 0,
          cacheCreationTokens: typeof startUsage.cache_creation_input_tokens === "number" ? startUsage.cache_creation_input_tokens : 0
        });
      }
      results.push(createChunk(state, { role: ROLE.ASSISTANT }));
      break;
    }

    case "content_block_start": {
      const block = chunk.content_block;
      if (block?.type === "server_tool_use") {
        // Built-in tool (web search) - Claude handles internally, skip
        state.serverToolBlockIndex = chunk.index;
        break;
      }
      if (block?.type === CLAUDE_BLOCK.TEXT) {
        state.textBlockStarted = true;
      } else if (block?.type === CLAUDE_BLOCK.THINKING) {
        state.inThinkingBlock = true;
        state.currentBlockIndex = chunk.index;
        results.push(createChunk(state, { content: "<think>" }));
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
      } else if (delta?.type === "thinking_delta" && delta.thinking) {
        results.push(createChunk(state, reasoningDelta(delta.thinking)));
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
      if (state.inThinkingBlock && chunk.index === state.currentBlockIndex) {
        results.push(createChunk(state, { content: "</think>" }));
        state.inThinkingBlock = false;
      }
      state.textBlockStarted = false;
      state.thinkingBlockStarted = false;
      break;
    }

    case "message_delta": {
      // Extract usage from message_delta event (Claude native format).
      // Anthropic sends input/cache in message_start and only output here, so
      // fall back to cache captured in message_start when the delta omits it.
      if (chunk.usage && typeof chunk.usage === "object") {
        const prev = state.usage || {};
        setUsageState(state, {
          inputTokens: typeof chunk.usage.input_tokens === "number" ? chunk.usage.input_tokens : (prev.input_tokens || 0),
          outputTokens: typeof chunk.usage.output_tokens === "number" ? chunk.usage.output_tokens : 0,
          cacheReadTokens: typeof chunk.usage.cache_read_input_tokens === "number" ? chunk.usage.cache_read_input_tokens : (prev.cache_read_input_tokens || 0),
          cacheCreationTokens: typeof chunk.usage.cache_creation_input_tokens === "number" ? chunk.usage.cache_creation_input_tokens : (prev.cache_creation_input_tokens || 0)
        });
      }

      if (chunk.delta?.stop_reason) {
        state.finishReason = convertStopReason(chunk.delta.stop_reason);
        const finalChunk = createChunk(state, {}, state.finishReason);

        if (state.usage) {
          // state.usage already merges cache from message_start with output from message_delta.
          finalChunk.usage = clientUsage(state.usage);
        }

        results.push(finalChunk);
        state.finishReasonSent = true;
      }
      break;
    }

    case "message_stop": {
      if (!state.finishReasonSent) {
        const finishReason = state.finishReason || (state.toolCalls?.size > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP);
        const usageObj = (state.usage && typeof state.usage === "object") ? { usage: clientUsage(state.usage) } : {};
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

