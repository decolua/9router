// Shared tool argument sanitizer — used by openai→claude response translator
// AND claude identity passthrough (stream.js PASSTHROUGH mode). Fixes bad
// params from non-Anthropic models (ollama /v1/messages, GLM, etc.).

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
export const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// AskUserQuestion schema: questions[].options maxItems:4 (Claude Code rejects >4).
const ASK_USER_QUESTION_MAX_OPTIONS = 4;

/**
 * Sanitize tool call arguments to fix bad params from non-Anthropic models.
 * @param {string} toolName - Tool name (may have proxy_ prefix).
 * @param {string} argsJson - JSON string of tool args.
 * @returns {string} Sanitized JSON string (or original on parse failure).
 */
export function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    if (name === "AskUserQuestion") sanitizeAskUserQuestionArgs(args);
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

/**
 * Sanitize Read tool args: clamp numeric bounds, drop invalid PDF pages.
 */
export function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

/**
 * Sanitize AskUserQuestion args:
 * - Coerce questions from JSON string to array (ollama emits string, Claude Code expects array).
 * - Cap questions[].options to maxItems:4 (Claude Code rejects >4 with too_big).
 */
export function sanitizeAskUserQuestionArgs(args) {
  // Coerce questions from JSON string to array
  if (typeof args.questions === "string") {
    try {
      args.questions = JSON.parse(args.questions);
    } catch {
      // Can't parse — leave as-is (don't break the stream)
    }
  }
  // Cap options per question to maxItems:4
  if (Array.isArray(args.questions)) {
    for (const q of args.questions) {
      if (q && Array.isArray(q.options) && q.options.length > ASK_USER_QUESTION_MAX_OPTIONS) {
        q.options = q.options.slice(0, ASK_USER_QUESTION_MAX_OPTIONS);
      }
    }
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}