import { FORMATS } from "../formats.js";
import { fromOpenAIFinish } from "./finishReason.js";
import { CLAUDE_BLOCK, MODEL_FALLBACK, RESPONSES_ITEM, ROLE } from "../schema/index.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function openAICompletionToClaudeMessage(responseBody) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    content.push({ type: CLAUDE_BLOCK.THINKING, thinking: reasoning });
  }
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: CLAUDE_BLOCK.TOOL_USE,
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  if (content.length === 0) content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });

  const usage = responseBody.usage || {};
  const rawId = String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "");
  const messageId = rawId.startsWith("msg_") ? rawId : (rawId ? `msg_${rawId}` : `msg_${Date.now()}`);

  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : (typeof usage.input_tokens === "number" ? usage.input_tokens : 0);
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : (typeof usage.output_tokens === "number" ? usage.output_tokens : 0);
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? usage.cache_read_input_tokens;
  const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens ?? usage.cache_creation_input_tokens;
  const cacheRead = typeof cachedTokens === "number" ? cachedTokens : 0;
  const cacheCreate = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;
  const inputTokens = Math.max(0, promptTokens - cacheRead - cacheCreate);

  const claudeUsage = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
  if (cacheRead > 0) claudeUsage.cache_read_input_tokens = cacheRead;
  if (cacheCreate > 0) claudeUsage.cache_creation_input_tokens = cacheCreate;

  return {
    id: messageId,
    type: RESPONSES_ITEM.MESSAGE,
    role: ROLE.ASSISTANT,
    model: responseBody.model || MODEL_FALLBACK,
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}
