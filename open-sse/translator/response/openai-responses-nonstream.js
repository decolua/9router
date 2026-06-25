import { ROLE, CLAUDE_BLOCK, RESPONSES_ITEM, MODEL_FALLBACK } from "../schema/index.js";

function n(value) {
  return typeof value === "number" ? value : 0;
}

function usageFromResponses(responseUsage) {
  const raw = responseUsage && typeof responseUsage === "object" ? responseUsage : {};
  const inputTotal = n(raw.input_tokens) || n(raw.prompt_tokens);
  const outputTokens = n(raw.output_tokens) || n(raw.completion_tokens);
  const cacheRead = n(raw.input_tokens_details?.cached_tokens) || n(raw.cache_read_input_tokens);
  const cacheCreate = n(raw.cache_creation_input_tokens);
  const freshInput = Math.max(0, inputTotal - cacheRead - cacheCreate);

  return {
    claude: {
      input_tokens: freshInput,
      output_tokens: outputTokens,
      ...(cacheRead > 0 ? { cache_read_input_tokens: cacheRead } : {}),
      ...(cacheCreate > 0 ? { cache_creation_input_tokens: cacheCreate } : {}),
    },
    openai: {
      prompt_tokens: inputTotal,
      completion_tokens: outputTokens,
      total_tokens: inputTotal + outputTokens,
      ...(cacheRead > 0 ? { prompt_tokens_details: { cached_tokens: cacheRead } } : {}),
    },
  };
}

function responseObject(responseBody) {
  return responseBody?.response && typeof responseBody.response === "object"
    ? responseBody.response
    : responseBody;
}

function extractOutputItems(responseBody) {
  const response = responseObject(responseBody);
  if (Array.isArray(response?.output)) return response.output;
  return [];
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === RESPONSES_ITEM.OUTPUT_TEXT || part?.type === RESPONSES_ITEM.SUMMARY_TEXT || part?.type === "text") return part.text || "";
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("");
}

function extractReasoningText(item) {
  if (!item || item.type !== RESPONSES_ITEM.REASONING) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.reasoning === "string") return item.reasoning;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.summary)) return extractTextFromContent(item.summary);
  if (Array.isArray(item.content)) return extractTextFromContent(item.content);
  return "";
}

function terminalError(responseBody) {
  const response = responseObject(responseBody);
  const status = response?.status;
  const error = response?.error || responseBody?.error;
  if (error) return { status: status || "failed", detail: error };
  if (status === "failed" || status === "cancelled") return { status, detail: response?.incomplete_details || null };
  if (status === "incomplete") return { status, detail: response?.incomplete_details || null };
  return null;
}

function terminalMessage(terminal) {
  const detail = terminal?.detail;
  if (!terminal) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail?.message === "string") return detail.message;
  if (typeof detail?.reason === "string") return detail.reason;
  if (detail) return JSON.stringify(detail);
  return `Response ended with status ${terminal.status}`;
}

function collectResponsesOutput(responseBody) {
  const items = extractOutputItems(responseBody);
  let text = "";
  let reasoning = "";
  const toolCalls = [];

  for (const item of items) {
    if (item?.type === RESPONSES_ITEM.MESSAGE) {
      text += extractTextFromContent(item.content);
      continue;
    }
    if (item?.type === RESPONSES_ITEM.REASONING) {
      reasoning += extractReasoningText(item);
      continue;
    }
    if (item?.type === RESPONSES_ITEM.FUNCTION_CALL || item?.type === "custom_tool_call") {
      toolCalls.push({
        id: item.call_id || item.id || `call_${toolCalls.length}`,
        name: item.name || "",
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
      });
    }
  }

  if (!text && typeof responseObject(responseBody)?.output_text === "string") text = responseObject(responseBody).output_text;
  return { text, reasoning, toolCalls, terminal: terminalError(responseBody) };
}

export function openAIResponsesBodyToClaude(responseBody) {
  const response = responseObject(responseBody);
  const { text, reasoning, toolCalls, terminal } = collectResponsesOutput(responseBody);
  const usage = usageFromResponses(response?.usage || responseBody?.usage).claude;
  const content = [];

  if (reasoning) content.push({ type: CLAUDE_BLOCK.THINKING, thinking: reasoning });
  if (text) content.push({ type: CLAUDE_BLOCK.TEXT, text });
  if (terminal) content.push({ type: CLAUDE_BLOCK.TEXT, text: `[Error] ${terminalMessage(terminal)}` });
  for (const call of toolCalls) {
    content.push({
      type: CLAUDE_BLOCK.TOOL_USE,
      id: call.id,
      name: call.name,
      input: safeJsonParse(call.arguments),
    });
  }

  return {
    id: response?.id || `msg_${Date.now()}`,
    type: "message",
    role: ROLE.ASSISTANT,
    model: response?.model || MODEL_FALLBACK,
    content,
    stop_reason: terminal?.status === "incomplete" ? "max_tokens" : (toolCalls.length > 0 ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage,
  };
}

export function openAIResponsesBodyToOpenAI(responseBody) {
  const response = responseObject(responseBody);
  const { text, reasoning, toolCalls, terminal } = collectResponsesOutput(responseBody);
  const terminalText = terminal ? `[Error] ${terminalMessage(terminal)}` : "";
  const content = [text, terminalText].filter(Boolean).join(text && terminalText ? "\n" : "");
  const message = { role: ROLE.ASSISTANT, content };

  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    if (!text && !terminalText) message.content = null;
  }

  return {
    id: response?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: response?.created_at || response?.created || Math.floor(Date.now() / 1000),
    model: response?.model || MODEL_FALLBACK,
    choices: [{
      index: 0,
      message,
      finish_reason: terminal?.status === "incomplete" ? "length" : (toolCalls.length > 0 ? "tool_calls" : "stop"),
    }],
    usage: usageFromResponses(response?.usage || responseBody?.usage).openai,
  };
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
