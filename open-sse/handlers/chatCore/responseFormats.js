import { FORMATS } from "../../translator/formats.js";
import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { ROLE, RESPONSES_ITEM } from "../../translator/schema/index.js";

export function parseToolArguments(value) {
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
  const claudeUsage = {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
  };
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
  if (cacheRead > 0) claudeUsage.cache_read_input_tokens = cacheRead;
  const cacheCreate = usage.cache_creation_input_tokens || usage.prompt_tokens_details?.cache_creation_tokens || 0;
  if (cacheCreate > 0) claudeUsage.cache_creation_input_tokens = cacheCreate;

  let msgId = String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "").replace(/^resp_/, "");
  if (!msgId.startsWith("msg_")) msgId = `msg_${msgId}`;

  return {
    id: msgId,
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}

export function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

export function openAICompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    const custom = customToolNames?.has(fn.name);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = responseBody.usage || {};
  const status = choice.finish_reason === "tool_calls" ? "completed" : (choice.finish_reason === "stop" ? "completed" : (choice.finish_reason || "completed"));

  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status,
    background: false,
    error: null,
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  };
}

export function extractTextFromResponsesOutput(output) {
  if (!Array.isArray(output)) return "";
  const texts = [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          texts.push(part.text);
        } else if (typeof part?.text === "string") {
          texts.push(part.text);
        }
      }
    }
  }
  return texts.join("");
}

export function extractReasoningFromResponsesOutput(output) {
  if (!Array.isArray(output)) return "";
  const reasoningTexts = [];
  for (const item of output) {
    if (item?.type === "reasoning") {
      if (Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (typeof s?.text === "string") reasoningTexts.push(s.text);
        }
      } else if (typeof item.reasoning === "string") {
        reasoningTexts.push(item.reasoning);
      }
    }
  }
  return reasoningTexts.join("\n");
}

export function extractToolCallsFromResponsesOutput(output) {
  if (!Array.isArray(output)) return [];
  const toolCalls = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id || item.id || `call_${item.name || "tool"}_${Date.now()}_${toolCalls.length}`,
        type: "function",
        function: {
          name: item.name || "",
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
        },
      });
    } else if (item.type === "custom_tool_call") {
      toolCalls.push({
        id: item.call_id || item.id || `call_${item.name || "tool"}_${Date.now()}_${toolCalls.length}`,
        type: "function",
        function: {
          name: item.name || "",
          arguments: typeof item.input === "string" ? item.input : JSON.stringify(item.input || {}),
        },
      });
    }
  }
  return toolCalls;
}

export function responsesToOpenAICompletion(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return responseBody;
  if (responseBody.choices) return responseBody;

  const output = responseBody.output || [];
  const textContent = extractTextFromResponsesOutput(output);
  const reasoningContent = extractReasoningFromResponsesOutput(output);
  const toolCalls = extractToolCallsFromResponsesOutput(output);
  const hasToolCalls = toolCalls.length > 0;

  const message = { role: "assistant" };
  if (textContent) message.content = textContent;
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (hasToolCalls) message.tool_calls = toolCalls;
  if (!message.content && !message.tool_calls) message.content = "";

  const responseDone = responseBody.status === "completed" || responseBody.status === "done";
  const finishReason = hasToolCalls ? "tool_calls" : (responseDone ? "stop" : (responseBody.status || "stop"));

  const usage = responseBody.usage || {};
  // Per Responses API spec, input_tokens is already cache-inclusive.
  // Cache info (cached_tokens) is reported in input_tokens_details as a subset breakdown,
  // not an additive value.
  const inTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outTokens = usage.output_tokens || usage.completion_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || usage.input_tokens_details?.cached_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || usage.input_tokens_details?.cache_creation_tokens || 0;

  const cacheDetails = (cacheRead > 0 || cacheCreate > 0)
    ? {
        prompt_tokens_details: {
          ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
          ...(cacheCreate > 0 ? { cache_creation_tokens: cacheCreate } : {}),
        },
      }
    : {};

  return {
    id: String(responseBody.id || `chatcmpl-${Date.now()}`).replace(/^resp_/, "chatcmpl-"),
    object: "chat.completion",
    created: responseBody.created_at || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: inTokens,
      completion_tokens: outTokens,
      total_tokens: usage.total_tokens || (inTokens + outTokens),
      ...cacheDetails,
    },
  };
}

export function responsesToClaudeMessage(responseBody) {
  const openAIComp = responsesToOpenAICompletion(responseBody);
  return openAICompletionToClaudeMessage(openAIComp);
}
