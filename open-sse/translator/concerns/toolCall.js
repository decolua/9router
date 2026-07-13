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
// Extract text content from a tool_result block (Claude-shaped) or tool message (OpenAI-shaped).
// Returns "" when there is no text (e.g. image-only tool_result — tracked separately in #2122).
function extractToolResultText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("\n")
    .trim();
}

// Salvage orphaned tool results — results that reference a tool call no longer
// present in the same request. Mirrors fixMissingToolResponses on the result side:
// that helper ensures every call has a result; this one ensures every result has a call.
//
// Instead of deleting orphaned results (which preempts format-specific salvage paths
// like Kiro's reconcileOrphanedToolResults and loses tool output context), this folds
// the orphan's text content into a user-text block: `[Tool result: <text>]`.
// Image-only results (no text) are still dropped — no text representation exists (#2122).
//
// Handles two wire envelopes (three schemas):
//   - OpenAI/Claude messages[]: orphaned role:"tool" / tool_result blocks → user text
//   - Gemini/Antigravity contents[]: orphaned functionResponse parts → user text part
//
// Responses API function_call_output is handled separately in openai-responses.js
// (stripOrphanedToolOutputs) because Responses items have no text representation
// to salvage — they are structural call/output pairs, not content blocks.
//
// After salvaging messages[], consecutive same-role user messages are merged so
// downstream translators that don't merge (notably openai-to-gemini, which pushes
// each role:"user" as a separate contents[] entry) don't emit adjacent user turns
// that trigger Gemini 400 INVALID_ARGUMENT.
//
// Fail-open: any error returns the body unchanged.
export function salvageOrphanedToolResults(body) {
  if (!body || typeof body !== "object") return body;

  try {
    let changed = false;

    // ── OpenAI/Claude messages[] ───────────────────────────────────────────
    if (Array.isArray(body.messages)) {
      const knownCallIds = new Set();
      for (const msg of body.messages) {
        // Only assistant turns carry tool calls — collecting from other roles
        // causes false positives (a user message with tool_use would mask orphans).
        if (msg.role !== "assistant") continue;

        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (typeof tc?.id === "string") knownCallIds.add(tc.id);
          }
        }

        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block?.type === "tool_use" && typeof block.id === "string") {
              knownCallIds.add(block.id);
            }
          }
        }
      }

      const salvagedMessages = [];
      // Track IDs already matched to a tool result — duplicates are salvaged too,
      // since strict providers reject a second result for the same call_id.
      const consumedIds = new Set();

      for (const msg of body.messages) {
        // OpenAI shape: orphaned role:"tool" message → salvage to user text
        if (msg.role === "tool" && msg.tool_call_id) {
          if (knownCallIds.has(msg.tool_call_id) && !consumedIds.has(msg.tool_call_id)) {
            consumedIds.add(msg.tool_call_id);
            salvagedMessages.push(msg);
          } else {
            const text = extractToolResultText(msg.content);
            if (text) {
              salvagedMessages.push({ role: "user", content: `[Tool result: ${text}]` });
            }
            changed = true;
          }
          continue;
        }

        // Claude shape: orphaned tool_result block in user content → salvage to text block
        if (Array.isArray(msg.content)) {
          let orphanCount = 0;
          const rebuiltContent = [];

          for (const block of msg.content) {
            if (block?.type !== "tool_result") {
              rebuiltContent.push(block);
              continue;
            }
            if (typeof block.tool_use_id === "string" && knownCallIds.has(block.tool_use_id) && !consumedIds.has(block.tool_use_id)) {
              consumedIds.add(block.tool_use_id);
              rebuiltContent.push(block);
              continue;
            }
            // Orphaned or duplicate tool_result — salvage text content
            orphanCount++;
            const text = extractToolResultText(block.content);
            if (text) {
              rebuiltContent.push({ type: "text", text: `[Tool result: ${text}]` });
            }
          }

          if (orphanCount > 0) {
            changed = true;
            if (rebuiltContent.length === 0) continue; // all blocks were image-only orphans
            msg.content = rebuiltContent;
          }
        }

        salvagedMessages.push(msg);
      }

      if (changed) {
        body.messages = mergeConsecutiveUserMessages(salvagedMessages);
      }
    }

    // ── Gemini/Antigravity contents[] ──────────────────────────────────────
    if (Array.isArray(body.contents)) {
      const knownFnIds = new Set();
      for (const turn of body.contents) {
        // Only model turns carry functionCall — collecting from other roles
        // causes false positives (a malformed user turn with functionCall would mask orphans).
        if (turn.role !== "model") continue;
        if (!Array.isArray(turn.parts)) continue;
        for (const part of turn.parts) {
          if (part?.functionCall) {
            // Prefer explicit id; fall back to name (older Gemini shapes pair by name).
            const key = part.functionCall.id ?? part.functionCall.name;
            if (key) knownFnIds.add(key);
          }
        }
      }

      // Only scan for orphans if there are functionResponse parts to check.
      if (body.contents.some(t => Array.isArray(t.parts) && t.parts.some(p => p.functionResponse))) {
        const consumedFnIds = new Set();
        const salvagedContents = [];

        for (const turn of body.contents) {
          if (!Array.isArray(turn.parts) || !turn.parts.some(p => p.functionResponse)) {
            salvagedContents.push(turn);
            continue;
          }
          let orphanCount = 0;
          const rebuiltParts = [];

          for (const part of turn.parts) {
            if (!part.functionResponse) {
              rebuiltParts.push(part);
              continue;
            }
            const key = part.functionResponse.id ?? part.functionResponse.name;
            if (key && knownFnIds.has(key) && !consumedFnIds.has(key)) {
              consumedFnIds.add(key);
              rebuiltParts.push(part);
              continue;
            }
            // Orphaned or duplicate functionResponse — salvage response content to text part
            orphanCount++;
            const resp = part.functionResponse.response;
            const raw = resp?.result ?? resp;
            const text = typeof raw === "string" ? raw.trim() : (raw ? JSON.stringify(raw).trim() : "");
            if (text) {
              rebuiltParts.push({ text: `[Tool result: ${text}]` });
            }
          }

          if (orphanCount > 0) {
            changed = true;
            // Drop the turn entirely if all parts were image-only orphans (no text salvaged).
            // Gemini rejects turns with empty parts[] (400 INVALID_ARGUMENT).
            if (rebuiltParts.length === 0) continue;
            turn.parts = rebuiltParts;
          }

          salvagedContents.push(turn);
        }

        if (changed) {
          body.contents = salvagedContents;
        }
      }
    }

    return body;
  } catch {
    return body;
  }
}

// Merge consecutive same-role user messages so downstream translators that don't
// merge (notably openai-to-gemini) don't emit adjacent user turns after salvage.
// Only merges string-content user messages; array-content messages are left as-is
// (they may carry structured blocks like tool_result that shouldn't be concatenated).
//
// Clone-on-merge: when concatenating, replace the last entry with a new object
// instead of mutating it in place. This preserves the original message reference
// in the caller's view (continuity canonicalization, logging, etc. may hold refs).
// Non-merged messages are pushed by reference (no unnecessary clones).
function mergeConsecutiveUserMessages(messages) {
  const merged = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === "user" && msg.role === "user"
        && typeof last.content === "string" && typeof msg.content === "string") {
      merged[merged.length - 1] = { ...last, content: `${last.content}\n${msg.content}` };
    } else {
      merged.push(msg);
    }
  }
  return merged;
}


export function fixMissingToolResponses(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;

  const newMessages = [];
  let changed = false;

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
      changed = true;
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

  if (!changed) return body;
  body.messages = newMessages;
  return body;
}

