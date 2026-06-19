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
      // Extract usage from message_delta event (Claude native format)
      // Normalize to OpenAI format (prompt_tokens/completion_tokens) for consistent logging
      if (chunk.usage && typeof chunk.usage === "object") {
        const inputTokens = typeof chunk.usage.input_tokens === "number" ? chunk.usage.input_tokens : 0;
        const outputTokens = typeof chunk.usage.output_tokens === "number" ? chunk.usage.output_tokens : 0;
        const cacheReadTokens = typeof chunk.usage.cache_read_input_tokens === "number" ? chunk.usage.cache_read_input_tokens : 0;
        const cacheCreationTokens = typeof chunk.usage.cache_creation_input_tokens === "number" ? chunk.usage.cache_creation_input_tokens : 0;

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
          finalChunk.usage = toOpenAIUsage(chunk.usage, "claude");
        }

        results.push(finalChunk);
        state.finishReasonSent = true;
      }
      break;
    }

    case "message_stop": {
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

