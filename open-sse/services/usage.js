/**
 * Usage Fetcher barrel — routes to provider-specific modules.
 *
 * Actual implementations live in:
 *   - ./usage-utils.js         (shared constants, parseResetTime)
 *   - ./usage-github.js        (GitHub Copilot)
 *   - ./usage-gemini.js        (Gemini CLI)
 *   - ./usage-antigravity.js   (Antigravity / Cloud Code)
 *   - ./usage-claude.js        (Claude OAuth + legacy)
 *   - ./usage-codex.js         (Codex / OpenAI)
 *   - ./usage-kiro.js          (Kiro / AWS CodeWhisperer)
 *   - ./usage-minimax.js       (MiniMax Token/Coding Plan)
 *   - ./usage-misc.js          (Qwen, iFlow, Ollama, GLM)
 */

import { getGitHubUsage } from "./usage-github.js";
import { getGeminiUsage } from "./usage-gemini.js";
import { getAntigravityUsage } from "./usage-antigravity.js";
import { getClaudeUsage } from "./usage-claude.js";
import { getCodexUsage } from "./usage-codex.js";
import { getKiroUsage } from "./usage-kiro.js";
import { getMiniMaxUsage } from "./usage-minimax.js";
import {
  getQwenUsage,
  getIflowUsage,
  getOllamaUsage,
  getGlmUsage,
} from "./usage-misc.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
export async function getUsageForProvider(connection, proxyOptions = null) {
  const { provider, accessToken, apiKey, providerSpecificData, projectId } =
    connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  switch (provider) {
    case "github":
      return await getGitHubUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "gemini-cli":
      return await getGeminiUsage(
        accessToken,
        providerDataWithProjectId,
        proxyOptions,
      );
    case "antigravity":
      return await getAntigravityUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(
        accessToken,
        providerSpecificData,
        proxyOptions,
      );
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken);
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
