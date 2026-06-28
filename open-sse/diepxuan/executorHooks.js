import { isDiepXuanEnabled } from "../../src/diepxuan/shared/config/flags.js";

// NVIDIA Chat Completions API (integrate.api.nvidia.com) accepts standard OpenAI
// Chat Completions params but rejects OpenAI Responses / Codex SDK extras such as
// `text`, `client_metadata`, `reasoning`, `store`, and top-level `parallel_tool_calls`.
// Keep this as a conservative allowlist based on NVIDIA's published example payload.
const NVIDIA_ALLOWED = new Set([
  "model", "messages",
  "max_tokens", "max_completion_tokens",
  "temperature", "top_p", "top_k",
  "stop", "stream",
  "presence_penalty", "frequency_penalty",
  "logit_bias", "user", "seed",
  "response_format",
  "tools", "tool_choice"
]);

/**
 * Strip OpenAI Responses / Codex SDK passthrough params that NVIDIA Chat
 * Completions endpoint rejects with HTTP 400.
 * Only applies when provider === "nvidia".
 * @param {string} provider
 * @param {object} body - Request body
 * @returns {object} Body with unsupported params removed
 */
export function stripNvidiaUnsupportedParams(provider, body) {
  if (!isDiepXuanEnabled()) return body;
  if (provider !== "nvidia") return body;

  const result = {};
  for (const key of Object.keys(body)) {
    if (NVIDIA_ALLOWED.has(key)) {
      result[key] = body[key];
    }
  }
  return result;
}