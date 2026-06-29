/**
 * Parse provider error responses to extract context length.
 * Updates cache when a 400 "max context length" error is observed.
 */

import { upsertContextLength, SOURCE_ERROR } from "./cache.js";

// Match patterns from different providers
// OpenAI: "context_length_exceeded ... maximum context length is 8192 tokens"
// Anthropic: "prompt is too long: 1234 tokens > 8000 maximum"
// NVIDIA: "maximum context length is 196608 tokens. However, your messages resulted in 319662 tokens"
// Minimax/Mistral: "model's maximum context length is X tokens"
const PATTERNS = [
  /maximum\s+context\s+length\s+is\s+(\d+)\s+tokens/i,
  /context\s+length\s+exceeded.*?(\d+)/i,
  /prompt\s+is\s+too\s+long.*?(\d+)\s+maximum/i,
  /max\s+context.*?(\d+)/i
];

/**
 * Extract context length from error message.
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {number|null} Context length in tokens, or null
 */
export function extractContextLengthFromError(status, errorText) {
  if (status !== 400 && status !== 413) return null;
  if (!errorText || typeof errorText !== "string") return null;

  for (const pattern of PATTERNS) {
    const match = errorText.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > 0) return num;
    }
  }
  return null;
}

/**
 * Update cache when an error reveals a model's context limit.
 * Returns the extracted length if found, null otherwise.
 * @param {number} status
 * @param {string} errorText
 * @param {string} modelId - Full model ID, e.g. "nvidia/minimaxai/minimax-m2.7"
 */
export function updateContextLengthFromError(status, errorText, modelId) {
  if (!modelId) return null;
  const length = extractContextLengthFromError(status, errorText);
  if (length) {
    upsertContextLength(modelId, length, SOURCE_ERROR);
  }
  return length;
}