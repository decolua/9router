/**
 * OpenAI to Cursor Request Translator
 * - assistant tool_calls → kept as-is (Cursor generates tool calls)
 * - Claude tool_use blocks → converted to OpenAI tool_calls format
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

// Build a map of tool_use_id → tool_name from the previous assistant message
function getToolNameMap(prevMsg) {
  const map = {};
  if (!prevMsg?.tool_calls) return map;
  for (const tc of prevMsg.tool_calls) {
    if (tc.id && tc.function?.name) map[tc.id] = tc.function.name;
  }
  return map;
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
      if (Array.isArray(msg.content)) {
        const parts = [];
        const prevMsg = result[result.length - 1];
        const nameMap = getToolNameMap(prevMsg);
        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push(block.text);
          } else if (block.type === "tool_result") {
            // Claude format: user message with tool_result blocks
            const toolResultText = extractContent(block.content) || "";
            const toolCallId = block.tool_use_id || "";
            const toolName = nameMap[toolCallId] || "";
            parts.push(`<tool_result>\n<tool_name>${toolName}</tool_name>\n<tool_call_id>${toolCallId}</tool_call_id>\n<result>${toolResultText}</result>\n</tool_result>`);
          }
        }
        result.push({ role: "user", content: parts.join("\n") || "" });
      } else {
        result.push({ role: "user", content: extractContent(msg.content) || "" });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Strip system-reminder tags injected by Claude Code
      const raw = extractContent(msg.content) || "";
      const toolContent = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      const prevMsg = result[result.length - 1];
      const nameMap = getToolNameMap(prevMsg);
      const toolCallId = msg.tool_call_id || "";
      const toolName = nameMap[toolCallId] || "";
      result.push({
        role: "user",
        content: `<tool_result>\n<tool_name>${toolName}</tool_name>\n<tool_call_id>${toolCallId}</tool_call_id>\n<result>${toolContent}</result>\n</tool_result>`
      });
      continue;
    }

    if (msg.role === "assistant") {
      let content = extractContent(msg.content) || "";
      let tool_calls = null;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // OpenAI format: strip `index` field
        tool_calls = msg.tool_calls.map(({ index, ...tc }) => tc);
      } else if (Array.isArray(msg.content)) {
        // Claude format: extract tool_use blocks from content array
        const extracted = msg.content
          .filter(b => b.type === "tool_use")
          .map(b => ({
            id: b.id,
            type: "function",
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input || {})
            }
          }));
        if (extracted.length > 0) tool_calls = extracted;
      }

      if (tool_calls) {
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
