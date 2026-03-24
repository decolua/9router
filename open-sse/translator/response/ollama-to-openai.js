import { register } from "../index.js";
import { FORMATS } from "../formats.js";

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
export function ollamaToOpenAI(chunk, state) {
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
    
    // Determine finish_reason based on done_reason and previous tool_calls
    let finishReason = "stop";
    if (chunk.done_reason === "tool_calls" || state.hadToolCalls) {
      finishReason = "tool_calls";
    }

    return {
      id: id,
      object: "chat.completion.chunk",
      created: created,
      model: model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }],
      usage: usage
    };
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

  return {
    id: id,
    object: "chat.completion.chunk",
    created: created,
    model: model,
    choices: [{
      index: 0,
      delta: delta,
      finish_reason: null
    }]
  };
}

/**
 * Extract usage stats from Ollama response
 */
function extractUsage(ollamaChunk) {
  return {
    prompt_tokens: ollamaChunk.prompt_eval_count || 0,
    completion_tokens: ollamaChunk.eval_count || 0,
    total_tokens: (ollamaChunk.prompt_eval_count || 0) + (ollamaChunk.eval_count || 0)
  };
}

/**
 * Convert tool_calls from Ollama format to OpenAI format
 */
function convertToolCalls(toolCalls) {
  return toolCalls.map((tc, i) => ({
    index: tc.function?.index ?? i,
    id: tc.id || `call_${i}_${Date.now()}`,
    type: "function",
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

  const message = { role: "assistant" };
  if (content) message.content = content;
  if (thinking) message.reasoning_content = thinking;
  if (toolCalls.length > 0) message.tool_calls = convertToolCalls(toolCalls);
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = body.done_reason || "stop";
  if (toolCalls.length > 0) finishReason = "tool_calls";

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
register(FORMATS.OLLAMA, FORMATS.OPENAI, null, ollamaToOpenAI);
