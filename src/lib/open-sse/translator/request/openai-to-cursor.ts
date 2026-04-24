/**
 * OpenAI to Cursor Request Translator
 * Converts OpenAI messages to Cursor ask/agent format.
 */
import { register } from "../index";
import { FORMATS } from "../formats";

function extractContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => {
        if (!part || typeof part !== "object") return false;
        return part.type === "text" && typeof part.text === "string";
      })
      .map((part: any) => part.text || "")
      .join("");
  }
  return "";
}

function sanitizeToolResultText(text: string) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildToolResultBlock(toolName: string, toolCallId: string, resultText: string) {
  const cleanResult = sanitizeToolResultText(resultText || "");
  return [
    "<tool_result>",
    `<tool_name>${escapeXml(toolName || "tool")}</tool_name>`,
    `<tool_call_id>${escapeXml(toolCallId || "")}</tool_call_id>`,
    `<result>${escapeXml(cleanResult)}</result>`,
    "</tool_result>"
  ].join("\n");
}

function normalizeToolCallId(id: string) {
  return typeof id === "string" ? id.split("\n")[0] : "";
}

function convertMessages(messages: any[]) {
  const result: any[] = [];
  
  const toolCallMetaMap = new Map<string, { name: string }>();
  const rememberToolMeta = (toolCallId: string, toolName: string) => {
    if (!toolCallId) return;
    const name = toolName || "tool";
    toolCallMetaMap.set(toolCallId, { name });
    const normalized = normalizeToolCallId(toolCallId);
    if (normalized && normalized !== toolCallId) {
      toolCallMetaMap.set(normalized, { name });
    }
  };

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        rememberToolMeta(tc.id || "", tc.function?.name || "tool");
      }
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== "tool_use") continue;
        rememberToolMeta(part.id || "", part.name || "tool");
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "system") {
      result.push({
        role: "user",
        content: `[System Instructions]\n${extractContent(msg.content)}`
      });
      continue;
    }

    if (msg.role === "tool") {
      const toolContent = extractContent(msg.content);
      const toolCallId = msg.tool_call_id || "";
      const toolMeta = toolCallMetaMap.get(toolCallId) || {};
      const toolName = msg.name || (toolMeta as any).name || "tool";
      result.push({
        role: "user",
        content: buildToolResultBlock(toolName, toolCallId, toolContent)
      });
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const block of msg.content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === "text") {
            if (typeof block.text === "string") {
              parts.push(block.text || "");
            }
            continue;
          }
          if (block.type === "tool_result") {
            const toolCallId = block.tool_use_id || "";
            const toolMeta =
              toolCallMetaMap.get(toolCallId) ||
              toolCallMetaMap.get(normalizeToolCallId(toolCallId));
            const toolName = toolMeta?.name || "tool";
            const toolContent = extractContent(block.content);
            parts.push(buildToolResultBlock(toolName, toolCallId, toolContent));
          }
        }
        const joined = parts.filter(Boolean).join("\n");
        if (joined) result.push({ role: "user", content: joined });
        continue;
      }

      const content = extractContent(msg.content);

      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const assistantMsg: any = { role: "assistant", content: content || "" };
        assistantMsg.tool_calls = msg.tool_calls.map((tc: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { index, ...rest } = tc || {};
          return rest;
        });
        result.push(assistantMsg);
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const extractedToolCalls = msg.content
          .filter((b: any) => b?.type === "tool_use")
          .map((b: any) => ({
            id: b.id || "",
            type: "function",
            function: {
              name: b.name || "tool",
              arguments: JSON.stringify(b.input || {})
            }
          }))
          .filter((tc: any) => tc.id);

        if (extractedToolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: content || "",
            tool_calls: extractedToolCalls
          });
        } else if (content) {
          result.push({ role: "assistant", content });
        }
      } else {
        if (content) {
          result.push({ role: msg.role, content });
        }
      }
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildCursorRequest(model: string, body: any, stream: boolean, credentials?: any) {
  const messages = convertMessages(body.messages || []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;
  return {
    ...rest,
    messages,
    max_tokens: 32000
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, buildCursorRequest, null);
register(FORMATS.OPENAI, FORMATS.CURSOR_CU, buildCursorRequest, null);
