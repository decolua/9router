import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { fallbackToolCallId } from "../concerns/toolCall.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";

/**
 * Convert Ollama NDJSON response to OpenAI SSE format
 *
 * Ollama response format:
 * {"model": "...", "message": {"role": "assistant", "content": "..."}, "done": false}
 * {"model": "...", "done": true, "prompt_eval_count": 123, "eval_count": 456}
 *
 * OpenAI format:
 * {"id": "...", "object": "chat.completion.chunk", "created": 123, "model": "...",
 *  "choices": [{"index": 0, "delta": {"content": "..."}, "finish_reason": null}]}
 */
export function ollamaToOpenAIResponse(chunk, state) {
  if (!chunk || typeof chunk !== "object") return null;

  // Initialize state on first chunk
  if (!state.ollama) {
    state.ollama = {
      id: `chatcmpl-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      model: chunk.model || state.model
    };
  }

  const { id, created, model } = state.ollama;

  // Final chunk with done=true
  if (chunk.done) {
    const usage = extractUsage(chunk);
    
    // Determine finish_reason: map upstream done_reason, override to tool_calls if tools used
    let finishReason = toOpenAIFinish(chunk.done_reason, "ollama");
    if (chunk.done_reason === OPENAI_FINISH.TOOL_CALLS || state.hadToolCalls) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }

    const doneChunk = buildChunk({ id, created, model }, {}, finishReason);
    doneChunk.usage = usage;
    return doneChunk;
  }

  // Content chunk
  const message = chunk.message;
  if (!message) return null;

  const content = typeof message.content === "string" ? message.content : "";
  const thinking = typeof message.thinking === "string" ? message.thinking : "";
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : null;

  // Skip empty chunks
  if (!content && !thinking && !toolCalls) return null;

  // Accumulate content in state
  if (content) {
    state.accumulatedContent = (state.accumulatedContent || "") + content;
  }
  if (thinking) {
    state.accumulatedThinking = (state.accumulatedThinking || "") + thinking;
  }

  const delta = {};
  if (content) delta.content = content;
  if (thinking) delta.reasoning_content = thinking;
  
  // Convert Ollama tool_calls to OpenAI format
  if (toolCalls) {
    state.hadToolCalls = true;
    delta.tool_calls = convertToolCalls(toolCalls);
  }

  return buildChunk({ id, created, model }, delta, null);
}

/**
 * Extract usage stats from Ollama response
 */
function extractUsage(ollamaChunk) {
  return toOpenAIUsage(ollamaChunk, "ollama");
}

/**
 * Convert tool_calls from Ollama format to OpenAI format
 */
function convertToolCalls(toolCalls) {
  return toolCalls.map((tc, i) => ({
    index: tc.function?.index ?? i,
    id: tc.id || fallbackToolCallId(i),
    type: OPENAI_BLOCK.FUNCTION,
    function: {
      name: tc.function?.name || "",
      arguments: typeof tc.function?.arguments === "string"
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments || {})
    }
  }));
}

/**
 * Convert Ollama non-streaming response body to OpenAI chat.completion format
 */
export function ollamaBodyToOpenAI(body) {
  const msg = body.message || {};
  const content = msg.content || "";
  const thinking = msg.thinking || "";
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

  const message = { role: ROLE.ASSISTANT };
  if (content) message.content = content;
  if (thinking) message.reasoning_content = thinking;
  if (toolCalls.length > 0) message.tool_calls = convertToolCalls(toolCalls);
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = toOpenAIFinish(body.done_reason, "ollama");
  if (toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "ollama",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: extractUsage(body)
  };
}

// Register translator
register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAIResponse);
