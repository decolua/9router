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
  // OpenAI prompt_tokens includes cached and cache-write tokens; Claude reports
  // them apart. Split them the same way the streaming translator does
  // (openai-to-claude.js), otherwise a non-stream /v1/messages client sees no
  // cache hit at all even when the upstream served one.
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.prompt_tokens_details?.cache_creation_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const claudeUsage = {
    input_tokens: usage.prompt_tokens !== undefined ? Math.max(0, prompt - cacheRead - cacheWrite) : prompt,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
  };
  if (cacheRead > 0) claudeUsage.cache_read_input_tokens = cacheRead;
  if (cacheWrite > 0) claudeUsage.cache_creation_input_tokens = cacheWrite;
  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: RESPONSES_ITEM.MESSAGE,
    role: ROLE.ASSISTANT,
    model: responseBody.model || MODEL_FALLBACK,
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}
