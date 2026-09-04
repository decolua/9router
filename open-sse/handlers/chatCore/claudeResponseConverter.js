import { FORMATS } from "../../translator/formats.js";
import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Convert an OpenAI Chat Completions response body into an Anthropic Claude Message response.
 * @param {object} responseBody - OpenAI Chat Completion object
 * @returns {object} Claude Message object
 */
export function chatCompletionToClaudeMessage(responseBody) {
  if (!responseBody) return responseBody;
  if (responseBody.type === "message" && Array.isArray(responseBody.content)) {
    return responseBody; // Already Claude message
  }
  if (!responseBody.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    content.push({
      type: "thinking",
      thinking: reasoning,
      signature: DEFAULT_THINKING_CLAUDE_SIGNATURE
    });
  }
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const usage = responseBody.usage || {};
  const claudeUsage = {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
  };
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens;
  if (typeof cacheRead === "number" && cacheRead > 0) {
    claudeUsage.cache_read_input_tokens = cacheRead;
  }
  if (typeof usage.cache_creation_input_tokens === "number" && usage.cache_creation_input_tokens > 0) {
    claudeUsage.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  }

  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}
