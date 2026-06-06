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
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}
