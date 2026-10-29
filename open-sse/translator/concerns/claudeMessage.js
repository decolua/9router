import { FORMATS } from "../formats.js";
import { fromOpenAIFinish } from "./finishReason.js";
import { CLAUDE_BLOCK, MODEL_FALLBACK, RESPONSES_ITEM, ROLE } from "../schema/index.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";

export function findToolSchema(toolName, tools) {
  if (!tools || !Array.isArray(tools)) return null;
  const cleanName = typeof toolName === "string" && toolName.startsWith("proxy_") ? toolName.slice("proxy_".length) : toolName;
  for (const t of tools) {
    const name = t?.name || t?.function?.name;
    if (name === toolName || name === cleanName) {
      return t.input_schema || t.parameters || t?.function?.parameters || t?.function?.input_schema;
    }
  }
  return null;
}

export function stripUnexpectedReasonArg(toolName, args, tools) {
  if (!args || typeof args !== "object" || !("reason" in args)) return;

  if (Array.isArray(tools)) {
    const schema = findToolSchema(toolName, tools);
    if (schema) {
      const props = schema.properties;
      if (props && typeof props === "object" && !("reason" in props)) {
        delete args.reason;
      }
      return;
    }
  }

  const knownZeroArgTools = new Set([
    "CronList",
    "TaskList",
    "preview_list",
    "tabs_context",
    "get_settings",
    "list_terminal_tabs",
    "capabilities",
    "model_profile"
  ]);
  const cleanName = typeof toolName === "string" && toolName.startsWith("proxy_") ? toolName.slice("proxy_".length) : toolName;
  if (knownZeroArgTools.has(cleanName) || knownZeroArgTools.has(toolName)) {
    delete args.reason;
  }
}

export function sanitizeStartSessionArgs(toolName, args) {
  if (!args || typeof args !== "object") return;
  const name = typeof toolName === "string" && toolName.startsWith("proxy_")
    ? toolName.slice("proxy_".length)
    : toolName;
  if (name === "start_session" || name.endsWith("start_session")) {
    if (args.initiation === "offer") {
      args.initiation = "user_asked";
    }
    if (args.target === "cloud") {
      args.target = "local";
    }
  }
}

function parseToolArguments(value, toolName = "", options = {}) {
  let args = {};
  if (!value) args = {};
  else if (typeof value === "object") args = { ...value };
  else {
    try {
      args = JSON.parse(value);
    } catch {
      args = {};
    }
  }
  if (toolName) {
    const tools = options?.body?.tools || options?.tools;
    stripUnexpectedReasonArg(toolName, args, tools);
    sanitizeStartSessionArgs(toolName, args);
  }
  return args;
}

export function openAICompletionToClaudeMessage(responseBody, options = {}) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    const isOmitted = options?.thinkingDisplay === "omitted"
      || options?.body?.thinking?.display === "omitted"
      || responseBody?._thinkingDisplay === "omitted";
    content.push({
      type: CLAUDE_BLOCK.THINKING,
      thinking: isOmitted ? "" : reasoning,
      signature: message.thought_signature || DEFAULT_THINKING_CLAUDE_SIGNATURE,
    });
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
      input: parseToolArguments(fn.arguments || toolCall.arguments, fn.name || toolCall.name || "", options),
    });
  }
  if (content.length === 0) content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });

  const usage = responseBody.usage || {};
  let rawId = String(responseBody.id || "").replace(/^chatcmpl-/, "");
  if (!rawId || rawId.length < 8) rawId = `${Date.now()}`;
  const finalId = rawId.startsWith("msg_") ? rawId : `msg_${rawId}`;

  let stopReason = fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE);
  if (message.tool_calls && message.tool_calls.length > 0) {
    stopReason = "tool_use";
  } else if (!stopReason || stopReason === "stop") {
    stopReason = "end_turn";
  }

  const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
  const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens;
  const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
  const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheCreateTokens);

  const claudeUsage = {
    input_tokens: inputTokens,
    output_tokens: completionTokens,
  };
  if (cacheReadTokens > 0) claudeUsage.cache_read_input_tokens = cacheReadTokens;
  if (cacheCreateTokens > 0) claudeUsage.cache_creation_input_tokens = cacheCreateTokens;

  return {
    id: finalId,
    type: RESPONSES_ITEM.MESSAGE,
    role: ROLE.ASSISTANT,
    model: responseBody.model || MODEL_FALLBACK,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === "refusal" ? { type: "refusal", category: "general_harms" } : null,
    usage: claudeUsage,
  };
}
