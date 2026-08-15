// Tool call helper functions for translator

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

/**
 * Strip orphaned tool results — results that reference a tool call no longer
 * present in the same request. Client-side history truncation/summarisation can
 * remove an assistant turn that contained tool_calls while leaving the
 * corresponding tool result in the history; strict upstream APIs then reject
 * the whole request with a 400 before the model ever executes.
 *
 * Handles all four wire formats used by 9router:
 *   - OpenAI Chat Completions : messages[role=tool].tool_call_id
 *   - Anthropic Messages      : messages[role=user].content[type=tool_result].tool_use_id
 *   - OpenAI Responses API    : input[type=function_call_output].call_id
 *   - Gemini / Antigravity    : contents[].parts[].functionResponse.id|name
 *
 * Mutates body in-place (same pattern as fixMissingToolResponses).
 * Returns the number of orphaned items removed (0 = nothing changed).
 */
export function stripOrphanedToolResults(body) {
  let stripped = 0;

  // ── 1. OpenAI Chat Completions + Anthropic Messages (share body.messages) ──
  if (Array.isArray(body.messages)) {
    // Collect every live tool-call id from the full message list.
    const liveIds = new Set();
    for (const msg of body.messages) {
      // OpenAI assistant turn: tool_calls[].id
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id) liveIds.add(tc.id);
        }
      }
      // Anthropic assistant turn: content[type=tool_use].id
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.id) liveIds.add(block.id);
        }
      }
    }

    // Remove orphaned role:"tool" messages (OpenAI).
    const beforeMsgs = body.messages.length;
    body.messages = body.messages.filter(msg => {
      if (msg.role === "tool" && msg.tool_call_id) {
        return liveIds.has(msg.tool_call_id);
      }
      return true;
    });
    stripped += beforeMsgs - body.messages.length;

    // Remove orphaned tool_result content blocks from user messages (Anthropic).
    for (const msg of body.messages) {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const beforeBlocks = msg.content.length;
        msg.content = msg.content.filter(block => {
          if (block.type === "tool_result" && block.tool_use_id) {
            return liveIds.has(block.tool_use_id);
          }
          return true;
        });
        stripped += beforeBlocks - msg.content.length;
      }
    }
  }

  // ── 2. OpenAI Responses API: input[] ──────────────────────────────────────
  if (Array.isArray(body.input)) {
    const liveIds = new Set();
    for (const item of body.input) {
      if (item.type === "function_call" && item.call_id) liveIds.add(item.call_id);
    }
    if (liveIds.size > 0 || body.input.some(i => i.type === "function_call_output")) {
      const before = body.input.length;
      body.input = body.input.filter(item => {
        if (item.type === "function_call_output" && item.call_id) {
          return liveIds.has(item.call_id);
        }
        return true;
      });
      stripped += before - body.input.length;
    }
  }

  // ── 3. Gemini / Antigravity: contents[] ───────────────────────────────────
  if (Array.isArray(body.contents)) {
    const liveIds = new Set();
    for (const turn of body.contents) {
      if (!Array.isArray(turn.parts)) continue;
      for (const part of turn.parts) {
        if (!part.functionCall) continue;
        // Prefer explicit id; fall back to name when id is absent (older Gemini shapes).
        const key = part.functionCall.id ?? part.functionCall.name;
        if (key) liveIds.add(key);
      }
    }
    if (liveIds.size > 0 || body.contents.some(t => Array.isArray(t.parts) && t.parts.some(p => p.functionResponse))) {
      for (const turn of body.contents) {
        if (!Array.isArray(turn.parts)) continue;
        const before = turn.parts.length;
        turn.parts = turn.parts.filter(part => {
          if (!part.functionResponse) return true;
          const key = part.functionResponse.id ?? part.functionResponse.name;
          return key ? liveIds.has(key) : true;
        });
        stripped += before - turn.parts.length;
      }
    }
  }

  return stripped;
}

