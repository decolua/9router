// Pure, DOM-free analysis of the request messages stored on a request detail.
//
// These functions back the "Request" panel of the usage dashboard by turning a
// stored conversation into a normalized, render-ready structure plus aggregate
// statistics. The module is intentionally framework-free: it must never import
// React and must be resilient to the messy shapes providers persist
// (OpenAI string content, OpenAI tool_calls, Anthropic content blocks, and
// unknown non-text blocks).
//
// The public surface is three functions:
//   - hasAnalyzableRequestMessages(detail) -> boolean
//   - normalizeRequestMessages(detail)     -> { index, role, blocks }[]
//   - analyzeRequestMessages(detail)       -> { hasMessages, messages, stats }
//
// "detail" is the shape persisted on a request: `{ request: { messages } }`.

const TEXT_BLOCK = "text";
const TOOL_CALL_BLOCK = "tool_call";
const TOOL_USE_BLOCK = "tool_use";
const TOOL_RESULT_BLOCK = "tool_result";

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function extractMessages(detail) {
  if (!isObject(detail)) return null;
  const { request } = detail;
  if (!isObject(request)) return null;
  const { messages } = request;
  if (!Array.isArray(messages)) return null;
  return messages;
}

function readText(value) {
  if (typeof value === "string") return value;
  return null;
}

function normalizeMessageBlocks(rawMessage) {
  if (!isObject(rawMessage)) return [];
  const blocks = [];
  const { role, content } = rawMessage;

  const isToolRole = role === "tool" && typeof rawMessage.tool_call_id === "string";

  if (typeof content === "string") {
    if (!isToolRole && isNonBlankString(content)) {
      blocks.push({ type: TEXT_BLOCK, text: content });
    }
  } else if (Array.isArray(content) && !isToolRole) {
    for (const block of content) {
      appendContentBlock(blocks, block);
    }
  }

  // OpenAI style tool calls live beside the content field.
  if (Array.isArray(rawMessage.tool_calls)) {
    for (const call of rawMessage.tool_calls) {
      appendToolCall(blocks, call);
    }
  }

  // OpenAI role: "tool" responses identify the originating call via
  // tool_call_id and carry the raw result as a string.
  if (role === "tool" && typeof rawMessage.tool_call_id === "string") {
    if (content !== undefined && content !== null) {
      blocks.push({
        type: TOOL_RESULT_BLOCK,
        toolCallId: rawMessage.tool_call_id,
        content: normalizeToolResultContent(content),
      });
    }
  }

  return blocks;
}

function appendContentBlock(blocks, block) {
  if (!isObject(block)) return;

  switch (block.type) {
    case TEXT_BLOCK: {
      const text = readText(block.text);
      if (isNonBlankString(text)) {
        blocks.push({ type: TEXT_BLOCK, text });
      }
      return;
    }
    case TOOL_USE_BLOCK: {
      blocks.push({
        type: TOOL_USE_BLOCK,
        id: block.id,
        name: block.name,
        input: block.input,
      });
      return;
    }
    case TOOL_RESULT_BLOCK: {
      blocks.push({
        type: TOOL_RESULT_BLOCK,
        toolUseId: block.tool_use_id,
        content: normalizeToolResultContent(block.content),
      });
      return;
    }
    default: {
      blocks.push({ ...block });
    }
  }
}

function appendToolCall(blocks, call) {
  if (!isObject(call)) return;
  const fn = isObject(call.function) ? call.function : {};
  blocks.push({
    type: TOOL_CALL_BLOCK,
    id: call.id,
    name: fn.name,
    arguments: typeof fn.arguments === "string" ? fn.arguments : fn.arguments,
  });
}

function normalizeToolResultContent(content) {
  if (Array.isArray(content)) {
    return content.map((entry) => (isObject(entry) ? { ...entry } : entry));
  }
  return content;
}

function normalizeSingleMessage(rawMessage, index) {
  const blocks = normalizeMessageBlocks(rawMessage);
  if (blocks.length === 0) return null;
  const role = isObject(rawMessage) && typeof rawMessage.role === "string"
    ? rawMessage.role
    : "";
  return { index, role, blocks };
}

/**
 * True when the detail carries at least one message that normalizes to a
 * non-empty list of blocks.
 *
 * @param {unknown} detail
 * @returns {boolean}
 */
export function hasAnalyzableRequestMessages(detail) {
  const messages = extractMessages(detail);
  if (messages === null) return false;
  for (let i = 0; i < messages.length; i += 1) {
    if (normalizeMessageBlocks(messages[i]).length > 0) return true;
  }
  return false;
}

/**
 * Normalize the stored request messages into a render-ready array. Each entry
 * keeps the zero-based source index, its role, and a list of typed blocks.
 * Messages that produce no blocks are dropped.
 *
 * @param {unknown} detail
 * @returns {{ index: number, role: string, blocks: object[] }[]}
 */
export function normalizeRequestMessages(detail) {
  const messages = extractMessages(detail);
  if (messages === null) return [];
  const normalized = [];
  for (let i = 0; i < messages.length; i += 1) {
    const entry = normalizeSingleMessage(messages[i], i);
    if (entry !== null) normalized.push(entry);
  }
  return normalized;
}

function emptyStats() {
  return {
    messageCount: 0,
    textBlockCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    nonTextBlockCount: 0,
    roleCounts: {},
    totalCharacters: 0,
  };
}

/**
 * Normalize the stored request messages and compute aggregate statistics.
 *
 * @param {unknown} detail
 * @returns {{
 *   hasMessages: boolean,
 *   messages: { index: number, role: string, blocks: object[] }[],
 *   stats: {
 *     messageCount: number,
 *     textBlockCount: number,
 *     toolCallCount: number,
 *     toolResultCount: number,
 *     nonTextBlockCount: number,
 *     roleCounts: Record<string, number>,
 *     totalCharacters: number,
 *   },
 * }}
 */
export function analyzeRequestMessages(detail) {
  const messages = normalizeRequestMessages(detail);
  const stats = emptyStats();

  if (messages.length === 0) {
    return { hasMessages: false, messages, stats };
  }

  for (const message of messages) {
    stats.messageCount += 1;
    stats.roleCounts[message.role] = (stats.roleCounts[message.role] || 0) + 1;

    for (const block of message.blocks) {
      switch (block.type) {
        case TEXT_BLOCK: {
          stats.textBlockCount += 1;
          if (typeof block.text === "string") {
            stats.totalCharacters += block.text.length;
          }
          break;
        }
        case TOOL_CALL_BLOCK:
        case TOOL_USE_BLOCK: {
          stats.toolCallCount += 1;
          break;
        }
        case TOOL_RESULT_BLOCK: {
          stats.toolResultCount += 1;
          break;
        }
        default: {
          stats.nonTextBlockCount += 1;
        }
      }
    }
  }

  return { hasMessages: true, messages, stats };
}
