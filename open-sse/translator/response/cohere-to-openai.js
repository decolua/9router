import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * Convert a Cohere v2 streaming chunk to OpenAI chat.completion.chunk format.
 *
 * Cohere v2 SSE emits typed events:
 *   - message-start: starts the response, provides id and role
 *   - content-start / content-delta / content-end: text content blocks
 *   - message-end: finish_reason + usage
 *
 * Other event types (tool-*, citation-*, etc.) are ignored until full support is added.
 */
export function cohereToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  const type = chunk.type;

  if (type === "message-start") {
    const delta = chunk.delta?.message || {};
    state.messageId = chunk.id || `chatcmpl-${Date.now()}`;
    state.model = chunk.model || "command-a-03-2025";
    return {
      id: state.messageId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{ index: 0, delta: { role: delta.role || "assistant" }, finish_reason: null }]
    };
  }

  if (type === "content-delta") {
    const text = chunk.delta?.message?.content?.text;
    if (typeof text !== "string") return null;
    return {
      id: state.messageId || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model || "command-a-03-2025",
      choices: [{ index: chunk.index ?? 0, delta: { content: text }, finish_reason: null }]
    };
  }

  if (type === "message-end") {
    const rawReason = chunk.delta?.finish_reason || "COMPLETE";
    const finishReason = rawReason === "COMPLETE" ? "stop" : rawReason.toLowerCase();

    const usage = chunk.delta?.usage?.tokens || chunk.delta?.usage?.billed_units;
    const result = {
      id: state.messageId || `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model || "command-a-03-2025",
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = {
        prompt_tokens: usage.input_tokens ?? 0,
        completion_tokens: usage.output_tokens ?? 0,
        total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      };
      state.usage = result.usage;
    }
    return result;
  }

  // Ignore content-start, content-end, and other event types
  return null;
}

register(FORMATS.COHERE, FORMATS.OPENAI, null, cohereToOpenAIResponse);
