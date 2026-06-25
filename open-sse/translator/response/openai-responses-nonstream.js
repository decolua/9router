import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK } from "../schema/index.js";

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

function extractOutputItems(responseBody) {
  if (Array.isArray(responseBody?.output)) return responseBody.output;
  if (Array.isArray(responseBody?.response?.output)) return responseBody.response.output;
  return [];
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "output_text" || part?.type === "text") return part.text || "";
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .join("");
}

function collectResponsesOutput(responseBody) {
  const items = extractOutputItems(responseBody);
  let text = "";
  const toolCalls = [];

  for (const item of items) {
    if (item?.type === "message") {
      text += extractTextFromContent(item.content);
      continue;
    }
    if (item?.type === "function_call" || item?.type === "custom_tool_call") {
      toolCalls.push({
        id: item.call_id || item.id || `call_${toolCalls.length}`,
        name: item.name || "",
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
      });
    }
  }

  if (!text && typeof responseBody?.output_text === "string") text = responseBody.output_text;
  return { text, toolCalls };
}

export function openAIResponsesBodyToClaude(responseBody) {
  const { text, toolCalls } = collectResponsesOutput(responseBody);
  const usage = usageFromResponses(responseBody?.usage || responseBody?.response?.usage).claude;
  const content = [];

  if (text) content.push({ type: CLAUDE_BLOCK.TEXT, text });
  for (const call of toolCalls) {
    content.push({
      type: CLAUDE_BLOCK.TOOL_USE,
      id: call.id,
      name: call.name,
      input: safeJsonParse(call.arguments),
    });
  }

  return {
    id: responseBody?.id || responseBody?.response?.id || `msg_${Date.now()}`,
    type: "message",
    role: ROLE.ASSISTANT,
    model: responseBody?.model || responseBody?.response?.model || MODEL_FALLBACK,
    content,
    stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage,
  };
}

export function openAIResponsesBodyToOpenAI(responseBody) {
  const { text, toolCalls } = collectResponsesOutput(responseBody);
  const message = { role: ROLE.ASSISTANT, content: text || "" };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    if (!text) message.content = null;
  }

  return {
    id: responseBody?.id || responseBody?.response?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: responseBody?.created_at || responseBody?.created || Math.floor(Date.now() / 1000),
    model: responseBody?.model || responseBody?.response?.model || MODEL_FALLBACK,
    choices: [{
      index: 0,
      message,
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: usageFromResponses(responseBody?.usage || responseBody?.response?.usage).openai,
  };
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
