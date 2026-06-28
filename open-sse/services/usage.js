/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit };
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getCodeBuddyCnUsage } from "./usage/codebuddy-cn.js";
import {
  getQwenUsage,
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc.js";

/**
 * xAI (Grok) usage — passive rate-limit snapshot.
 *
 * xAI exposes no usage/quota endpoint. Instead we lift the x-ratelimit-*
 * headers from successful /v1/chat/completions responses (see chatCore.js)
 * and persist them per-connection as `rateLimitSnapshot`. This getter only
 * reads that stored snapshot — it never makes a network request, so refresh
 * is free and consumes no credit. The snapshot reflects the rate-limit window
 * at the time of the last Grok request, not a monthly quota.
 *
 * @param {Object} connection
 * @returns {Object} quotas-shaped usage, or a message when no snapshot exists
 */
export function getXaiUsage(connection) {
  const snap = connection?.rateLimitSnapshot;
  if (!snap || (snap.limitRequests == null && snap.limitTokens == null)) {
    return { message: "xAI connected. Rate-limit data appears after the first Grok request." };
  }

  const quotas = {};
  if (snap.limitRequests != null) {
    const total = Number(snap.limitRequests) || 0;
    const remaining = snap.remainingRequests != null ? Number(snap.remainingRequests) : total;
    quotas["Rate limit requests (window)"] = {
      total,
      used: Math.max(0, total - remaining),
      unit: "requests",
      resetAt: null,
    };
  }
  if (snap.limitTokens != null) {
    const total = Number(snap.limitTokens) || 0;
    const remaining = snap.remainingTokens != null ? Number(snap.remainingTokens) : total;
    quotas["Rate limit tokens (window)"] = {
      total,
      used: Math.max(0, total - remaining),
      unit: "tokens",
      resetAt: null,
    };
  }

  return { quotas, capturedAt: snap.capturedAt || null };
}

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  "gemini-cli": (c) => getGeminiUsage(c.accessToken, c.providerDataWithProjectId, c.proxyOptions),
  antigravity: (c) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: (c) => getQoderUsage(c.accessToken, c.proxyOptions),
  qwen: (c) => getQwenUsage(c.accessToken, c.providerSpecificData),
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.accessToken),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  xai: (c) => getXaiUsage(c.connection),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
};

export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ provider, accessToken, apiKey, providerSpecificData, providerDataWithProjectId, proxyOptions, connection });
}


/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */



