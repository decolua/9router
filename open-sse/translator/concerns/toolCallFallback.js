// Tool-calling auto fallback.
//
// Two jobs, both fail-open — a bug here must never turn a working request into
// a broken one, so every path returns the input untouched on any error:
//
//   repair()  — malform the payload before dispatch: malformed tool arguments,
//               orphaned tool results, a tool_choice pointing at a tool that
//               does not exist. One bad shape would otherwise burn every member
//               of a combo before the first one could answer.
//   degrade() — when an upstream rejects the request outright (400/404/422), drop
//               the tool machinery in escalating steps so the turn degrades into
//               a plain chat turn with the tool history inlined as prose, instead
//               of surfacing a tool error to the caller.

import { ROLE } from "../schema/roles.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "../schema/blocks.js";

// Highest level degrade() will apply. Levels are cumulative and each is more
// lossy than the last, so the caller stops at the first one the provider accepts.
export const TOOL_FALLBACK_MAX_LEVEL = 3;

// Upstream wording for "I will not accept this tool payload". Matched loosely on
// purpose: gateways disagree about the exact phrase but all name a tool, a
// function, or the schema.
const TOOL_ERROR_MARKERS = [
  "tool",
  "function_call",
  "function call",
  "tool_choice",
  "schema",
];

const NON_TOOL_ERROR_MARKERS = [
  "context length",
  "context_length",
  "too many tokens",
  "maximum context",
  "content policy",
  "content_policy",
];

// JSON Schema keywords that pass OpenAI's validator and are rejected elsewhere.
// Kept narrow: dropping a keyword a provider does accept only weakens the schema
// the model was given, it never changes the tool's name or arguments.
const FRAGILE_SCHEMA_KEYWORDS = [
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "additionalProperties",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  "const",
  "examples",
  "default",
  "contentEncoding",
  "contentMediaType",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
];

export function isToolCallRejection(status, message) {
  if (![400, 404, 406, 422, 500].includes(status)) return false;
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return false;
  if (NON_TOOL_ERROR_MARKERS.some((m) => text.includes(m))) return false;
  return TOOL_ERROR_MARKERS.some((m) => text.includes(m));
}

// Close whatever the model left open when it stopped mid-JSON. A truncated tool
// argument is the usual cause of a client reporting a missing required property:
// the model meant to emit {"command":"ls"} and emitted {"command":"ls.
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }

  if (inString) text += '"';
  // A dangling key ("command": ) never became a value; drop it.
  text = text.replace(/,\s*("[^"]*"\s*)\:\s*$/, "");
  text = text.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) text += stack[i] === "{" ? "}" : "]";
  return text;
}

// Normalise one tool_call's arguments into a parseable JSON string.
function normalizeArguments(args) {
  if (args == null) return "{}";
  if (typeof args === "object") {
    try { return JSON.stringify(args); } catch { return "{}"; }
  }
  if (typeof args !== "string") return "{}";

  const trimmed = args.trim();
  if (!trimmed) return "{}";
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch { /* fall through to repair */ }

  try {
    JSON.parse(repairTruncatedJson(trimmed));
    return repairTruncatedJson(trimmed);
  } catch {
    return "{}";
  }
}

function toolName(tool) {
  return tool?.function?.name || tool?.name || null;
}

function toolSchema(tool) {
  return tool?.function?.parameters ?? tool?.parameters ?? tool?.input_schema ?? null;
}

// Claude / OpenAI tool arrays wrap the schema differently; strip the fragile
// keywords wherever they sit without touching names or descriptions.
function stripFragileKeywords(node) {
  if (Array.isArray(node)) {
    for (const item of node) stripFragileKeywords(item);
    return node;
  }
  if (!node || typeof node !== "object") return node;
  for (const key of Object.keys(node)) {
    if (FRAGILE_SCHEMA_KEYWORDS.includes(key)) { delete node[key]; continue; }
    stripFragileKeywords(node[key]);
  }
  return node;
}

function hasTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0;
}

function cloneBody(body) {
  return {
    ...body,
    ...(Array.isArray(body.tools) ? { tools: body.tools.map((t) => ({ ...t })) } : {}),
    ...(Array.isArray(body.messages)
      ? { messages: body.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : m.content })) }
      : {}),
    ...(Array.isArray(body.input) ? { input: body.input.map((i) => ({ ...i })) } : {}),
    ...(Array.isArray(body.contents) ? { contents: body.contents.map((c) => ({ ...c, parts: Array.isArray(c.parts) ? c.parts.map((p) => ({ ...p })) : c.parts })) } : {}),
  };
}

function collectOpenAIIds(messages) {
  const ids = new Set();
  for (const msg of messages) {
    if (msg?.role !== ROLE.ASSISTANT || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) if (tc?.id) ids.add(tc.id);
  }
  return ids;
}

function collectClaudeIds(messages) {
  const ids = new Set();
  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) continue;
    for (const block of msg.content) {
      if (block?.type === CLAUDE_BLOCK.TOOL_USE && block.id) ids.add(block.id);
    }
  }
  return ids;
}

function collectResponsesIds(input) {
  const ids = new Set();
  for (const item of input) {
    if (item?.type === RESPONSES_ITEM.FUNCTION_CALL && item.call_id) ids.add(item.call_id);
  }
  return ids;
}

export function repair(body, format) {
  try {
    if (!body || typeof body !== "object") return body;

    // OpenAI / Claude tool_calls arguments
    for (const msg of body.messages || []) {
      if (msg?.role === ROLE.ASSISTANT && Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls
          .filter((tc) => toolName(tc))
          .map((tc) => ({
            ...tc,
            type: tc.type || "function",
            function: { ...tc.function, arguments: normalizeArguments(tc.function?.arguments) },
          }));
      }
      if (!Array.isArray(msg.content)) continue;
      msg.content = msg.content
        .filter((block) => block?.type !== CLAUDE_BLOCK.TOOL_USE || !!block.name)
        .map((block) => (
          block?.type === CLAUDE_BLOCK.TOOL_USE && typeof block.input !== "object"
            ? { ...block, input: parseLooseJson(block.input) }
            : block
        ));
    }

    // Drop tool results nothing asked for — a stale id is a hard 400 upstream.
    if (Array.isArray(body.messages)) {
      const openAIIds = collectOpenAIIds(body.messages);
      const claudeIds = collectClaudeIds(body.messages);
      body.messages = body.messages
        .filter((msg) => msg?.role !== ROLE.TOOL || !msg.tool_call_id || openAIIds.has(msg.tool_call_id))
        .map((msg) => (
          Array.isArray(msg.content)
            ? { ...msg, content: msg.content.filter((b) => b?.type !== CLAUDE_BLOCK.TOOL_RESULT || !b.tool_use_id || claudeIds.has(b.tool_use_id)) }
            : msg
        ));
    }

    if (Array.isArray(body.input)) {
      const ids = collectResponsesIds(body.input);
      body.input = body.input.filter(
        (item) => item?.type !== RESPONSES_ITEM.FUNCTION_CALL_OUTPUT || !item.call_id || ids.has(item.call_id)
      );
    }

    // A tool_choice naming a tool that is not in the array is always a 400.
    if (body.tool_choice && typeof body.tool_choice === "object") {
      const named = body.tool_choice.name || body.tool_choice.function?.name;
      if (named && !body.tools.some((t) => toolName(t) === named)) delete body.tool_choice;
    }
    if ((body.tool_choice === "required" || body.tool_choice === "any") && !hasTools(body)) {
      delete body.tool_choice;
    }

    return body;
  } catch {
    return body;
  }
}

function parseLooseJson(value) {
  if (value == null || typeof value === "object") return {};
  try { return JSON.parse(value); } catch { /* fall through */ }
  try { return JSON.parse(repairTruncatedJson(String(value))); } catch { return {}; }
}

function inlineText(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  if (Array.isArray(value)) return value.map(inlineText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return "";
}

const TOOL_RESULT_PREFIX = "[Tool result: ";
const TOOL_CALL_PREFIX = "[Called tools: ";

// Rewrite tool turns into plain prose so the history survives once the tool
// definitions are gone. Without this the provider rejects a tool result that has
// no matching tool call — the error the fallback is trying to escape.
function flattenOpenAI(messages) {
  const out = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === ROLE.TOOL || msg.role === "function") {
      out.push({ role: ROLE.ASSISTANT, content: `${TOOL_RESULT_PREFIX}${inlineText(msg.content) || String(msg.content ?? "")}]` });
      continue;
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.tool_calls)) {
      const { tool_calls, ...rest } = msg;
      const names = tool_calls.map((c) => toolName(c) || "tool").join(", ");
      const base = inlineText(rest.content);
      out.push({ ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` });
      continue;
    }
    out.push(msg);
  }
  return out;
}

// Both shapes share the `messages` array, so pick per message rather than per
// body: a Claude turn carries tool_use/tool_result blocks in `content`, an
// OpenAI turn carries `tool_calls` / `role:"tool"`. A mixed body is legal during
// translation, so the choice is made message by message.
function flattenMessages(messages) {
  const out = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === ROLE.TOOL || msg.role === "function") {
      out.push({ role: ROLE.ASSISTANT, content: `${TOOL_RESULT_PREFIX}${inlineText(msg.content) || String(msg.content ?? "")}]` });
      continue;
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.tool_calls)) {
      const { tool_calls, ...rest } = msg;
      const names = tool_calls.map((c) => toolName(c) || "tool").join(", ");
      const base = inlineText(rest.content);
      out.push({ ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` });
      continue;
    }
    if (!Array.isArray(msg.content)) { out.push(msg); continue; }

    const kept = [];
    const results = [];
    const used = [];
    for (const block of msg.content) {
      if (block?.type === CLAUDE_BLOCK.TOOL_RESULT) { results.push(inlineText(block.content)); continue; }
      if (block?.type === CLAUDE_BLOCK.TOOL_USE) { used.push(block.name || "tool"); continue; }
      kept.push(block);
    }
    if (results.length) {
      out.push({ role: ROLE.ASSISTANT, content: `${TOOL_RESULT_PREFIX}${results.filter(Boolean).join("\n")}]` });
    }
    if (used.length) {
      out.push({ role: ROLE.ASSISTANT, content: `${TOOL_CALL_PREFIX}${used.join(", ")}]` });
    }
    if (kept.length) {
      out.push({ role: msg.role, content: inlineText(kept) });
    }
  }
  return out;
}

function flattenResponses(input) {
  return input.filter(
    (item) => item?.type !== RESPONSES_ITEM.FUNCTION_CALL_OUTPUT && item?.type !== RESPONSES_ITEM.FUNCTION_CALL
  );
}

function flattenGemini(contents) {
  return contents.map((c) => {
    if (!Array.isArray(c?.parts)) return c;
    const kept = c.parts.filter((p) => p?.functionCall == null && p?.functionResponse == null);
    return { ...c, role: c.role, parts: kept };
  }).filter((c) => Array.isArray(c.parts) ? c.parts.length > 0 : true);
}

// Apply one degradation step. Returns a new body, or null when the level has
// nothing left to remove (caller stops retrying at that point).
export function degrade(body, level) {
  try {
    if (!body || typeof body !== "object") return null;

    if (level === 1) {
      if (!hasTools(body)) return null;
      const next = cloneBody(body);
      // A forced choice is the least portable part of a tool request.
      delete next.tool_choice;
      for (const tool of next.tools || []) {
        delete tool.strict;
        if (tool.function) delete tool.function.strict;
      }
      return next;
    }

    if (level === 2) {
      if (!hasTools(body)) return null;
      const next = cloneBody(body);
      for (const tool of next.tools) {
        const schema = toolSchema(tool);
        if (schema) stripFragileKeywords(schema);
      }
      return next;
    }

    if (level === 3) {
      if (!hasTools(body)) return null;
      const next = cloneBody(body);
      delete next.tools;
      delete next.tool_choice;
      if (Array.isArray(next.messages)) next.messages = flattenMessages(next.messages);
      if (Array.isArray(next.input)) next.input = flattenResponses(next.input);
      if (Array.isArray(next.contents)) next.contents = flattenGemini(next.contents);
      return next;
    }

    return null;
  } catch {
    return null;
  }
}
