/**
 * Cursor model normalization and upstream resolution helpers.
 */

const LEGACY_MODEL_MAP = {
  "claude-3-5-sonnet": "claude-4.5-sonnet",
  "claude-3-5-sonnet-20241022": "claude-4.5-sonnet",
  "claude-3-5-sonnet-20240620": "claude-4.5-sonnet",
  "claude-3-5-haiku": "claude-4.5-haiku",
  "gpt-4o": "gpt-5.2",
  "gpt-4o-mini": "gpt-5.2",
};

const DEFAULT_UPSTREAM_MODEL =
  process.env.CURSOR_DEFAULT_UPSTREAM_MODEL || "claude-4.5-sonnet";

/**
 * Strip provider prefix and return bare Cursor model id.
 * @param {string} model
 * @returns {string}
 */
export function normalizeCursorModelId(model) {
  const raw = String(model || "").split("/").pop() || "";
  let id = raw;

  // Drop Anthropic-style date suffixes (e.g. claude-3-5-sonnet-20240620)
  const dateSuffix = id.match(/^(.+)-(\d{8})$/);
  if (dateSuffix) {
    id = dateSuffix[1];
  }

  return LEGACY_MODEL_MAP[id] || id;
}

/**
 * Resolve model id sent to Cursor upstream protobuf.
 * @param {string} model
 * @returns {string}
 */
export function resolveCursorUpstreamModel(model) {
  const id = normalizeCursorModelId(model);
  if (id === "default" || id === "auto") {
    return DEFAULT_UPSTREAM_MODEL;
  }
  return id;
}

/**
 * Whether thinking protobuf content should be promoted to visible assistant text.
 * @param {string} model
 * @returns {boolean}
 */
export function shouldPromoteThinkingToContent(model) {
  const id = normalizeCursorModelId(model);
  if (id === "default" || id === "auto") return true;
  if (/^composer(?:-|$)/i.test(id)) return true;
  if (/-thinking/i.test(id)) return true;
  return false;
}

/**
 * Extract user-visible text after redacted thinking block (Composer-style).
 * @param {string} thinking
 * @returns {string}
 */
export function visibleContentFromThinking(thinking) {
  if (!thinking) return "";
  const endTag = "</think>";
  const endIdx = thinking.lastIndexOf(endTag);
  if (endIdx < 0) return "";
  return thinking.slice(endIdx + endTag.length).trimStart();
}
