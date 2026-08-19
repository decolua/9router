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

function orphanToolResult(msg) {
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
  return {
    role: "user",
    content: `[Orphaned tool result${msg.tool_call_id ? ` ${msg.tool_call_id}` : ""}]\n${content}`,
  };
}

// Check if a following message contains at least one result for the calls.
// Kept exported for translators and tests that use the legacy helper.
export function hasToolResults(msg, toolCallIds) {
  if (!msg || !toolCallIds.length) return false;
  if (msg.role === "tool" && msg.tool_call_id) {
    return toolCallIds.includes(msg.tool_call_id);
  }
  if (msg.role === "user" && Array.isArray(msg.content)) {
    return msg.content.some((block) => block.type === "tool_result" && toolCallIds.includes(block.tool_use_id));
  }
  return false;
}

// Reconcile OpenAI tool-call batches. Every call must have exactly one adjacent
// result; compatible gateways reject partial parallel batches and orphan results.
export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    const toolCallIds = getToolCallIds(msg);
    if (toolCallIds.length > 0 && Array.isArray(msg.tool_calls)) {
      newMessages.push(msg);

      const expected = new Set(toolCallIds);
      const responded = new Set();
      const validResults = [];
      const orphanResults = [];
      let j = i + 1;

      while (j < body.messages.length && body.messages[j]?.role === "tool") {
        const result = body.messages[j];
        if (expected.has(result.tool_call_id) && !responded.has(result.tool_call_id)) {
          validResults.push(result);
          responded.add(result.tool_call_id);
        } else {
          orphanResults.push(orphanToolResult(result));
        }
        j++;
      }

      newMessages.push(...validResults);
      for (const id of toolCallIds) {
        if (!responded.has(id)) {
          newMessages.push({ role: "tool", tool_call_id: id, content: "[No response received]" });
        }
      }
      newMessages.push(...orphanResults);
      i = j - 1;
      continue;
    }

    // Preserve Claude-format tool_use/tool_result handling. Its results live
    // inside the next user content array rather than role:"tool" messages.
    if (toolCallIds.length > 0) {
      newMessages.push(msg);
      const nextMsg = body.messages[i + 1];
      if (nextMsg?.role === "user" && Array.isArray(nextMsg.content)) {
        const responded = new Set(
          nextMsg.content
            .filter((block) => block.type === "tool_result" && block.tool_use_id)
            .map((block) => block.tool_use_id),
        );
        for (const id of toolCallIds) {
          if (!responded.has(id)) {
            nextMsg.content.push({ type: "tool_result", tool_use_id: id, content: "[No response received]" });
          }
        }
      } else {
        for (const id of toolCallIds) {
          newMessages.push({ role: "tool", tool_call_id: id, content: "[No response received]" });
        }
      }
      continue;
    }

    if (msg.role === "tool") {
      newMessages.push(orphanToolResult(msg));
      continue;
    }

    newMessages.push(msg);
  }

  body.messages = newMessages;
  return body;
}

