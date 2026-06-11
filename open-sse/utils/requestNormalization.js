import { FORMATS } from "../translator/formats.js";

function isOpenAICompatibleProvider(provider) {
  return typeof provider === "string" && provider.startsWith("openai-compatible-");
}

function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

function hasNonEmptyContent(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    if (typeof part.text === "string" && part.text.trim()) return true;
    return part.type && part.type !== "text";
  });
  return content !== undefined && content !== null;
}

export function stripUnsupportedAssistantPrefill({ provider, sourceFormat, targetFormat, body, clientTool, log }) {
  if (!isOpenAICompatibleProvider(provider)) return body;
  if (targetFormat !== FORMATS.OPENAI) return body;
  if (sourceFormat !== FORMATS.CLAUDE && clientTool !== "claude") return body;
  if (!Array.isArray(body?.messages) || body.messages.length < 2) return body;

  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage?.role !== "assistant") return body;
  if (hasToolCalls(lastMessage)) return body;

  const previousMessages = body.messages.slice(0, -1);
  if (!previousMessages.some((message) => message.role === "user")) return body;

  log?.debug?.(
    "NORMALIZE",
    `stripped trailing Claude assistant prefill for OpenAI-compatible provider${hasNonEmptyContent(lastMessage) ? "" : " (empty)"}`
  );

  return { ...body, messages: previousMessages };
}
