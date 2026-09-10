/**
 * Sliding Window Context Compactor (Memory Optimization)
 *
 * Inspired by ai-memory's session distillation and compaction:
 * When conversations span 30-100+ turns, passing the entire raw message history
 * can exhaust provider context limits, cause latency spikes, and generate massive costs.
 *
 * This module monitors total message payload size/token estimate. When the threshold is
 * crossed, it preserves the system instruction and the most recent `recentTurnsToKeep` turns,
 * while consolidating older turns into a structured summary block.
 */

const DEFAULT_THRESHOLD_TOKENS = 128000;
const DEFAULT_RECENT_TURNS = 8;
const CHARS_PER_TOKEN_ESTIMATE = 3.8;

/**
 * Fast conservative token estimation
 * @param {Array} items
 * @returns {number}
 */
export function estimateTokenCount(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  try {
    const rawLength = JSON.stringify(items).length;
    return Math.ceil(rawLength / CHARS_PER_TOKEN_ESTIMATE);
  } catch {
    return 0;
  }
}

/**
 * Extract concise text summary from a message item
 * @param {Object} msg
 * @returns {string}
 */
function summarizeMessage(msg) {
  if (!msg) return "";
  const role = msg.role || (msg.type === "function_call_output" ? "tool" : "user");
  let contentText = "";

  if (typeof msg.content === "string") {
    contentText = msg.content;
  } else if (Array.isArray(msg.content)) {
    contentText = msg.content
      .map((c) => (c?.type === "text" ? c.text : c?.type === "tool_use" ? `[called tool: ${c.name}]` : c?.type === "tool_result" ? `[tool result: ${typeof c.content === "string" ? c.content.slice(0, 100) : "output"}]` : ""))
      .filter(Boolean)
      .join(" ");
  } else if (typeof msg.output === "string") {
    contentText = msg.output;
  } else if (Array.isArray(msg.parts)) {
    contentText = msg.parts
      .map((p) => p.text || (p.functionCall ? `[call: ${p.functionCall.name}]` : p.functionResponse ? `[result: ${p.functionResponse.name}]` : ""))
      .filter(Boolean)
      .join(" ");
  }

  // Bound the per-message summary to max 300 chars for the summary block
  const cleaned = contentText.replace(/\s+/g, " ").trim();
  const truncated = cleaned.length > 250 ? `${cleaned.slice(0, 250)}...` : cleaned;
  return truncated ? `- **${role.toUpperCase()}**: ${truncated}` : "";
}

/**
 * Compact older conversation history into a structured summary
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {boolean} options.enabled - Whether compaction is enabled
 * @param {number} [options.thresholdTokens=128000] - Token threshold to trigger compaction
 * @param {number} [options.recentTurnsToKeep=8] - Number of recent turns to keep intact
 * @returns {{ body: Object, compacted: boolean, originalTokens: number, newTokens: number }}
 */
export function compactContextWindow(body, options = {}) {
  const {
    enabled = false,
    thresholdTokens = DEFAULT_THRESHOLD_TOKENS,
    recentTurnsToKeep = DEFAULT_RECENT_TURNS,
  } = options;

  if (!enabled || !body || typeof body !== "object") {
    return { body, compacted: false, originalTokens: 0, newTokens: 0 };
  }

  const items = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
    ? body.input
    : null;

  if (!items || items.length <= recentTurnsToKeep + 2) {
    return { body, compacted: false, originalTokens: 0, newTokens: 0 };
  }

  const originalTokens = estimateTokenCount(items);
  if (originalTokens < thresholdTokens) {
    return { body, compacted: false, originalTokens, newTokens: originalTokens };
  }

  // Preserve system messages at the start
  const systemMessages = [];
  let conversationStartIndex = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.role === "system") {
      systemMessages.push(items[i]);
      conversationStartIndex = i + 1;
    } else {
      break;
    }
  }

  const conversationalItems = items.slice(conversationStartIndex);
  if (conversationalItems.length <= recentTurnsToKeep) {
    return { body, compacted: false, originalTokens, newTokens: originalTokens };
  }

  const splitIndex = conversationalItems.length - recentTurnsToKeep;
  const olderItems = conversationalItems.slice(0, splitIndex);
  const recentItems = conversationalItems.slice(splitIndex);

  // Generate structured summary from older items
  const summaryLines = olderItems
    .map(summarizeMessage)
    .filter(Boolean)
    .slice(-20); // Keep up to 20 key highlights

  const summaryContent = [
    `[Historical Context Summary by 9router Memory Optimizer]`,
    `Notice: Earlier conversation turns (${olderItems.length} messages) have been compacted to conserve context window.`,
    `Key highlights of earlier conversation:`,
    ...summaryLines,
  ].join("\n");

  const summaryMessage = {
    role: "user",
    content: summaryContent,
  };

  const syntheticAssistantAck = {
    role: "assistant",
    content: "I have reviewed and incorporated the summarized context from our previous turns. Continuing with the latest instructions.",
  };

  const compactedMessages = [
    ...systemMessages,
    summaryMessage,
    syntheticAssistantAck,
    ...recentItems,
  ];

  if (Array.isArray(body.messages)) {
    body.messages = compactedMessages;
  } else if (Array.isArray(body.input)) {
    body.input = compactedMessages;
  }

  const newTokens = estimateTokenCount(compactedMessages);

  return {
    body,
    compacted: true,
    originalTokens,
    newTokens,
    savedTokens: Math.max(0, originalTokens - newTokens),
  };
}
