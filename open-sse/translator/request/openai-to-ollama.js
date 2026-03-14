import { register } from "../index.js";
import { FORMATS } from "../formats.js";

/**
 * Convert OpenAI request to Ollama format
 *
 * Ollama expects:
 * - model: string
 * - messages: Array<{role: string, content: string}>
 * - stream: boolean
 * - options?: {temperature?: number, num_predict?: number}
 *
 * Key differences from OpenAI:
 * - Content must be string, not array
 * - No support for tool_calls in request (tools are handled differently)
 * - tool role maps to user
 */
export function openaiToOllamaRequest(model, body, stream) {
  const result = {
    model: model,
    messages: normalizeMessages(body.messages),
    stream: stream
  };

  // Temperature
  if (body.temperature !== undefined) {
    result.options = result.options || {};
    result.options.temperature = body.temperature;
  }

  // Max tokens (Ollama uses num_predict)
  if (body.max_tokens !== undefined) {
    result.options = result.options || {};
    result.options.num_predict = body.max_tokens;
  }

  // Top_p
  if (body.top_p !== undefined) {
    result.options = result.options || {};
    result.options.top_p = body.top_p;
  }

  // Tools (Ollama supports tools in OpenAI format)
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = body.tools;
  }

  // Tool choice
  if (body.tool_choice) {
    result.tool_choice = body.tool_choice;
  }

  return result;
}

/**
 * Normalize messages to Ollama format
 * - Content must be string
 * - tool messages: convert tool_call_id to tool_name
 * - assistant messages: keep tool_calls as-is
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return messages;

  const result = [];
  const toolCallMap = new Map(); // Map tool_call_id -> tool_name

  // First pass: build tool_call_id -> tool_name map from assistant messages
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          toolCallMap.set(tc.id, tc.function.name);
        }
      }
    }
  }

  // Second pass: convert messages
  for (const msg of messages) {
    // Handle tool result messages (OpenAI format -> Ollama format)
    if (msg.role === "tool") {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;

      // Get tool_name from map or use msg.name as fallback
      const toolName = toolCallMap.get(msg.tool_call_id) || msg.name || "unknown_tool";

      result.push({
        role: "tool",
        tool_name: toolName,
        content: toolResult
      });
      continue;
    }

    // Handle assistant messages with tool_calls
    if (msg.role === "assistant" && msg.tool_calls) {
      const content = normalizeContent(msg.content) || "";
      
      // Convert OpenAI tool_calls format to Ollama format
      const ollamaToolCalls = msg.tool_calls.map(tc => ({
        type: "function",
        function: {
          index: tc.index || 0,
          name: tc.function?.name || "",
          arguments: typeof tc.function?.arguments === "string" 
            ? JSON.parse(tc.function.arguments || "{}")
            : tc.function?.arguments || {}
        }
      }));

      result.push({
        role: "assistant",
        content: content,
        tool_calls: ollamaToolCalls
      });
      continue;
    }

    // Normal messages
    const role = msg.role;
    const content = normalizeContent(msg.content);

    // Skip empty messages (except assistant)
    if (!content && role !== "assistant") continue;

    result.push({
      role: role,
      content: content
    });
  }

  return result;
}

/**
 * Normalize content to string
 * Ollama only accepts string content
 */
function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    // Extract text from content array
    const textParts = content
      .filter(block => block && block.type === "text" && block.text)
      .map(block => block.text);

    return textParts.join("\n") || "";
  }

  return "";
}

// Register translator
register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
