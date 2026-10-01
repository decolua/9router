import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { parseDataUri } from "../concerns/image.js";
import { safeParseJSON } from "../concerns/json.js";
import { ROLE, OPENAI_BLOCK } from "../schema/index.js";

/**
 * Convert OpenAI request to Ollama format
 *
 * Ollama expects:
 * - model: string
 * - messages: Array<{role: string, content: string, images?: string[] }>
 * - stream: boolean
 * - options?: {temperature?: number, num_predict?: number}
 *
 * Key differences from OpenAI:
 * - Content must be string, not array
 * - Multimodal images should be mapped to `message.images[]` (raw base64, no data: prefix)
 * - tool role maps to tool (Ollama supports tool messages)
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
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
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
    if (msg.role === ROLE.TOOL) {
      const toolResult = normalizeContent(msg.content);
      if (!toolResult) continue;

      // Get tool_name from map or use msg.name as fallback
      const toolName = toolCallMap.get(msg.tool_call_id) || msg.name || "unknown_tool";

      result.push({
        role: ROLE.TOOL,
        tool_name: toolName,
        content: toolResult
      });
      continue;
    }

    // Handle assistant messages with tool_calls
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      const content = normalizeContent(msg.content) || "";
      
      // Convert OpenAI tool_calls format to Ollama format
      const ollamaToolCalls = msg.tool_calls.map(tc => ({
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          index: tc.index || 0,
          name: tc.function?.name || "",
          arguments: typeof tc.function?.arguments === "string" 
            ? safeParseJSON(tc.function.arguments || "{}", {})
            : tc.function?.arguments || {}
        }
      }));

      result.push({
        role: ROLE.ASSISTANT,
        content: content,
        tool_calls: ollamaToolCalls
      });
      continue;
    }

    // Normal messages
    const role = msg.role;
    const content = normalizeContent(msg.content);
    const images = extractImagesFromContent(msg.content);

    // Skip empty messages (except assistant)
    if (!content && role !== ROLE.ASSISTANT) continue;

    const out = {
      role: role,
      content: content
    };

    if (images.length > 0) {
      out.images = images;
    }

    result.push(out);
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
      .filter(block => block && block.type === OPENAI_BLOCK.TEXT && block.text)
      .map(block => block.text);

    return textParts.join("\n") || "";
  }

  return "";
}

/**
 * Extract base64 images from OpenAI multimodal content blocks.
 * OpenAI image block format:
 *   { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 * Ollama expects raw base64 strings in message.images[].
 */
function extractImagesFromContent(content) {
  if (!Array.isArray(content)) return [];

  const images = [];

  for (const block of content) {
    if (!block || block.type !== OPENAI_BLOCK.IMAGE_URL) continue;

    const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
    if (typeof url !== "string" || !url) continue;

    const parsed = parseDataUri(url);
    if (!parsed) continue;

    images.push(parsed.base64);
  }

  return images;
}

// Register translator
register(FORMATS.OPENAI, FORMATS.OLLAMA, openaiToOllamaRequest, null);
