/**
 * OpenAI to Cursor Request Translator
 * - assistant tool_calls → kept as-is (Cursor generates tool calls)
 * - tool results → converted to user message string
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

function extractContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(p => p.type === "text").map(p => p.text).join("");
  }
  return "";
}

function convertMessages(messages) {
  const result = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "system") {
      result.push({ role: "user", content: `[System Instructions]\n${msg.content}` });
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: extractContent(msg.content) || "" });
      continue;
    }

    if (msg.role === "tool") {
      // Strip system-reminder tags injected by Claude Code
      const raw = extractContent(msg.content) || "";
      const toolContent = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      // Find matching tool name from previous assistant message
      const prevMsg = result[result.length - 1];
      const toolName = prevMsg?.tool_calls?.[0]?.function?.name || "";
      const toolCallId = msg.tool_call_id || "";
      result.push({
        role: "user",
        content: `<tool_result>\n<tool_name>${toolName}</tool_name>\n<tool_call_id>${toolCallId}</tool_call_id>\n<result>${toolContent}</result>\n</tool_result>`
      });
      continue;
    }

    if (msg.role === "assistant") {
      const content = extractContent(msg.content) || "";
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Strip `index` field — not needed in history, may confuse Cursor
        const tool_calls = msg.tool_calls.map(({ index, ...tc }) => tc);
        result.push({ role: "assistant", content, tool_calls });
      } else if (content) {
        result.push({ role: "assistant", content });
      }
    }
  }

  return result;
}

export function buildCursorRequest(model, body, stream, credentials) {
  const messages = convertMessages(body.messages || []);
  // Strip fields irrelevant to Cursor (OpenAI/Anthropic-specific)
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;
  return {
    ...rest,
    messages,
    max_tokens: 32000
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, buildCursorRequest, null);
