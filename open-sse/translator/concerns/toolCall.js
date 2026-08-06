import { createHash } from "node:crypto";

// Tool call helper functions for translator

/**
 * Normalizes OpenAI function/tool names to satisfy provider naming constraints.
 * (OpenAI specification requirement: ^[a-zA-Z0-9_-]{1,64}$)
 *
 * - Replaces unsupported characters with underscores.
 * - Truncates names that exceed max length (default 64).
 * - Appends a deterministic SHA-256 hash suffix to avoid collisions.
 * - Supports OpenAI tool definitions (tool.function.name) and Claude/raw tool definitions (tool.name).
 * - Supports tool calls in messages (tool_calls[].function.name, content[type="tool_use"].name, role="tool").
 * - Returns a map of normalized names back to their original names.
 */
export function normalizeOpenAIToolNames(body, maxLength = 64) {
  const aliases = new Map();
  if (!body || typeof body !== "object") return aliases;
  const memo = new Map();

  const alias = (name) => {
    if (!name || typeof name !== "string") return name;
    if (memo.has(name)) return memo.get(name);

    const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const changed = safe !== name || safe.length > maxLength;

    const shortened = changed
      ? `${safe.slice(0, maxLength - 13)}_${createHash("sha256")
          .update(name)
          .digest("hex")
          .slice(0, 12)}`
      : safe;

    if (shortened !== name) {
      aliases.set(shortened, name);
    }
    memo.set(name, shortened);
    return shortened;
  };

  // Normalize tool definitions (both OpenAI and Claude/raw formats)
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (tool?.function?.name) {
        tool.function.name = alias(tool.function.name);
      }
      if (tool?.name && typeof tool.name === "string") {
        tool.name = alias(tool.name);
      }
    }
  }

  // Normalize explicit tool choice
  if (body.tool_choice) {
    if (body.tool_choice.function?.name) {
      body.tool_choice.function.name = alias(body.tool_choice.function.name);
    }
    if (typeof body.tool_choice.name === "string") {
      body.tool_choice.name = alias(body.tool_choice.name);
    }
  }

  // Normalize tool calls & tool results in conversation history
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== "object") continue;

      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (call?.function?.name) {
            call.function.name = alias(call.function.name);
          }
        }
      }

      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type === "tool_use" && block.name) {
            block.name = alias(block.name);
          }
        }
      }

      if (message.role === "tool" && message.name) {
        message.name = alias(message.name);
      }
    }
  }

  return aliases;
}

/**
 * Restores original OpenAI tool/function names from their normalized aliases.
 */
export function restoreOpenAIToolNames(body, aliases) {
  if (!aliases || typeof aliases !== "object" || !aliases.size) return false;

  let changed = false;

  const restoreCalls = (calls) => {
    if (!Array.isArray(calls)) return;
    for (const call of calls) {
      const name = call?.function?.name;
      if (name && aliases.has(name)) {
        call.function.name = aliases.get(name);
        changed = true;
      }
    }
  };

  if (Array.isArray(body?.choices)) {
    for (const choice of body.choices) {
      restoreCalls(choice?.delta?.tool_calls);
      restoreCalls(choice?.message?.tool_calls);
    }
  }

  return changed;
}

// Anthropic tool_use.id must match: ^[a-zA-Z0-9_-]+$
const TOOL_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Fallback streaming tool_call id when provider omits one (index optional)
export function fallbackToolCallId(index) {
  return index === undefined ? `call_${Date.now()}` : `call_${index}_${Date.now()}`;
}

// Generate deterministic tool call ID from position + tool name (cache-friendly)
export function generateToolCallId(msgIndex = 0, tcIndex = 0, toolName = "") {
  const name = toolName ? `_${toolName.replace(/[^a-zA-Z0-9_-]/g, "")}` : "";
  return `call_msg${msgIndex}_tc${tcIndex}${name}`;
}

// Sanitize ID to match Anthropic pattern: keep only alphanumeric, underscore, hyphen
function sanitizeToolId(id) {
  if (!id || typeof id !== "string") return null;
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : null;
}

// Ensure all tool_calls have valid id field and arguments is string (some providers require it)
export function ensureToolCallIds(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (let j = 0; j < msg.tool_calls.length; j++) {
        const tc = msg.tool_calls[j];
        // Validate or regenerate ID for Anthropic compatibility
        if (!tc.id || !TOOL_ID_PATTERN.test(tc.id)) {
          const sanitized = sanitizeToolId(tc.id);
          tc.id = sanitized || generateToolCallId(i, j, tc.function?.name);
        }
        if (!tc.type) {
          tc.type = "function";
        }
        // Ensure arguments is JSON string, not object
        if (tc.function?.arguments && typeof tc.function.arguments !== "string") {
          tc.function.arguments = JSON.stringify(tc.function.arguments);
        }
      }
    }

    // Validate tool_call_id in tool messages (role: "tool")
    if (msg.role === "tool" && msg.tool_call_id && !TOOL_ID_PATTERN.test(msg.tool_call_id)) {
      const sanitized = sanitizeToolId(msg.tool_call_id);
      msg.tool_call_id = sanitized || generateToolCallId(i, 0);
    }

    // Also validate tool_use blocks in content (Claude format)
    if (Array.isArray(msg.content)) {
      for (let k = 0; k < msg.content.length; k++) {
        const block = msg.content[k];
        if (block.type === "tool_use" && block.id && !TOOL_ID_PATTERN.test(block.id)) {
          const sanitized = sanitizeToolId(block.id);
          block.id = sanitized || generateToolCallId(i, k, block.name);
        }
        // Validate tool_use_id in tool_result blocks
        if (block.type === "tool_result" && block.tool_use_id && !TOOL_ID_PATTERN.test(block.tool_use_id)) {
          const sanitized = sanitizeToolId(block.tool_use_id);
          block.tool_use_id = sanitized || generateToolCallId(i, k);
        }
      }
    }
  }

  return body;
}

// Get tool_call ids from assistant message (OpenAI format: tool_calls, Claude format: tool_use in content)
export function getToolCallIds(msg) {
  if (msg.role !== "assistant") return [];

  const ids = [];

  // OpenAI format: tool_calls array
  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.id) ids.push(tc.id);
    }
  }

  // Claude format: tool_use blocks in content
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id) {
        ids.push(block.id);
      }
    }
  }

  return ids;
}

// Check if user message has tool_result for given ids (OpenAI format: role=tool, Claude format: tool_result in content)
export function hasToolResults(msg, toolCallIds) {
  if (!msg || !toolCallIds.length) return false;

  // OpenAI format: role = "tool" with tool_call_id
  if (msg.role === "tool" && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id);
  }

  // Claude format: tool_result blocks in user message content
  if (msg.role === "user" && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && toolCallIds.includes(block.tool_use_id)) {
        return true;
      }
    }
  }

  return false;
}

// Fix missing tool responses - insert empty tool_result if assistant has tool_use but next message has no tool_result
export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    const nextMsg = body.messages[i + 1];

    newMessages.push(msg);

    // Check if this is assistant with tool_calls/tool_use
    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length === 0) continue;

    // Check if next message has tool_result
    if (nextMsg && !hasToolResults(nextMsg, toolCallIds)) {
      // Insert tool responses for each tool_call
      for (const id of toolCallIds) {
        // OpenAI format: role = "tool"
        newMessages.push({
          role: "tool",
          tool_call_id: id,
          content: ""
        });
      }
    }
  }

  body.messages = newMessages;
  return body;
}


// NVIDIA-specific deterministic ID: prefer short 9-hex identifier for upstream
const nvidiaIdCache = new Map();
export function nvidiaToolCallId(id) {
  if (!id || typeof id !== 'string') return id;
  // Accept already-short alphanumeric IDs (9 chars)
  if (/^[a-zA-Z0-9]{9}$/.test(id)) return id;
  if (nvidiaIdCache.has(id)) return nvidiaIdCache.get(id);
  const hashed = createHash('sha256').update(id).digest('hex').slice(0, 9);
  nvidiaIdCache.set(id, hashed);
  return hashed;
}

// Normalize tool call IDs specifically for NVIDIA provider
export function normalizeNvidiaToolCallIds(body) {
  if (!body || !Array.isArray(body.messages)) return body;
  for (const msg of body.messages) {
    // OpenAI format: tool_calls array on assistant
    for (const tc of msg?.tool_calls || []) {
      if (tc && tc.id) tc.id = nvidiaToolCallId(tc.id);
    }
    // Tool message id
    if (msg && msg.tool_call_id) msg.tool_call_id = nvidiaToolCallId(msg.tool_call_id);
    // Claude format: tool_use blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        if ((block.type === 'tool_use' || block.type === 'tool_result') && block.id) {
          block.id = nvidiaToolCallId(block.id);
        }
        if (block.type === 'tool_result' && block.tool_use_id) {
          block.tool_use_id = nvidiaToolCallId(block.tool_use_id);
        }
      }
    }
  }
  return body;
}
