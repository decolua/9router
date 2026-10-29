import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { FORMATS } from "../../translator/formats.js";

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
 * Convert an OpenAI Chat Completions body into the Anthropic Messages shape.
 *
 * A Claude-format client (`POST /v1/messages`) reads `content[]`, never
 * `choices[]`: handing it a `chat.completion` body is a silent empty answer
 * (HTTP 200, no content) rather than an error. Two callers need this exact
 * conversion — the true non-streaming handler (chat-native upstream answered
 * with JSON) and the forced-stream aggregation (the upstream answered with an
 * event stream while the client asked for JSON) — so it lives here instead of
 * being copied into each. A fix applied to only one copy leaves the other
 * returning an OpenAI body, which is how this class of bug survives.
 */
export function claudeMessageFromChatCompletion(responseBody) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    content.push({ type: "thinking", thinking: reasoning });
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
  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    },
  };
}
