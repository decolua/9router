/**
 * OpenAI to Cursor Request Translator
 * Converts OpenAI messages to Cursor simple format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * Convert OpenAI messages to Cursor simple format
 * - system → user with [System Instructions] prefix
 * - tool → user with [Tool Result: name] prefix
 * - assistant with tool_calls → append [Calling tool: name with args: {...}] to content
 */
function convertMessages(messages) {
  const result = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({
        role: "user",
        content: `[System Instructions]\n${msg.content}`
      });
      continue;
    }

    if (msg.role === "tool") {
      let toolContent = "";
      if (typeof msg.content === "string") {
        toolContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            toolContent += part.text;
          }
        }
      }
      
      const toolName = msg.name || "tool";
      result.push({
        role: "user",
        content: `[Tool Result: ${toolName}]\n${toolContent}`
      });
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      let content = "";

      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            content += part.text;
          }
        }
      }

      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        if (content) {
          result.push({ role: "assistant", content });
        }
        
        const toolCallsText = msg.tool_calls.map(tc => {
          const funcName = tc.function?.name || "unknown";
          const funcArgs = tc.function?.arguments || "{}";
          return `[Calling tool: ${funcName} with args: ${funcArgs}]`;
        }).join("\n");
        
        result.push({
          role: "assistant",
          content: toolCallsText
        });
      } else if (content) {
        result.push({ role: msg.role, content });
      }
    }
  }

  return result;
}

/**
 * Transform OpenAI request to Cursor format
 * Returns modified body with converted messages
 */
export function buildCursorRequest(model, body, stream, credentials) {
  const messages = convertMessages(body.messages || []);
  
  return {
    ...body,
    messages
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, buildCursorRequest, null);
