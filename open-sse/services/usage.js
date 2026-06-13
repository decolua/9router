/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getAntigravityUsage } from "./usage/providers/antigravityUsage.js";
import { getClaudeUsage } from "./usage/providers/claudeUsage.js";
import { getCodexUsage } from "./usage/providers/codexUsage.js";
import { getGeminiUsage } from "./usage/providers/geminiUsage.js";
import { getGitHubUsage } from "./usage/providers/githubUsage.js";
import { getGlmUsage } from "./usage/providers/glmUsage.js";
import { getKiroUsage } from "./usage/providers/kiroUsage.js";
import { getMiniMaxUsage } from "./usage/providers/minimaxUsage.js";
import { getIflowUsage, getOllamaUsage, getQwenUsage } from "./usage/providers/passiveUsage.js";
import { CLIENT_METADATA, getPlatformUserAgent } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveDefaultProfileArn } from "../config/kiroConstants.js";

// GitHub API config
const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

// GLM quota endpoints (region-aware)
const GLM_QUOTA_URLS = {
  international: "https://api.z.ai/api/monitor/usage/quota/limit",
  china: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
};

// MiniMax usage endpoints (try in order, fallback on transient errors)
const MINIMAX_USAGE_URLS = {
  minimax: [
    "https://www.minimax.io/v1/token_plan/remains",
    "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  ],
  "minimax-cn": [
    "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
  ],
};

// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
// Docs: https://vercel.com/docs/ai-gateway/usage
const VERCEL_AI_GATEWAY_CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

// Antigravity API config (from Quotio)
const ANTIGRAVITY_CONFIG = {
  quotaApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  userAgent: getPlatformUserAgent(),
};

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};

// Claude API config
const CLAUDE_CONFIG = {
  oauthUsageUrl: "https://api.anthropic.com/api/oauth/usage",
  usageUrl: "https://api.anthropic.com/v1/organizations/{org_id}/usage",
  settingsUrl: "https://api.anthropic.com/v1/settings",
  apiVersion: "2023-06-01",
};

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken, providerSpecificData, proxyOptions);
    case "gemini-cli":
      return await getGeminiUsage(accessToken, providerDataWithProjectId, proxyOptions);
    case "antigravity":
      return await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(accessToken, providerSpecificData, proxyOptions);
    case "qoder":
      return await getQoderUsage(accessToken, proxyOptions);
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken, providerSpecificData);
    case "glm":
    case "glm-cn":
      return await getGlmUsage(apiKey, provider, proxyOptions);
    case "minimax":
    case "minimax-cn":
      return await getMiniMaxUsage(apiKey, provider, proxyOptions);
    case "vercel-ai-gateway":
      return await getVercelAiGatewayUsage(apiKey, proxyOptions);
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}
