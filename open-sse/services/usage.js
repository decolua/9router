/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getGeminiUsage, getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getKiroUsage } from "./usage/kiro.js";
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getCodeBuddyCnUsage, getCodeBuddyIntlUsage } from "./usage/codebuddy-cn.js";
import { getGrokCliUsage } from "./usage/grok-cli.js";
import { getKimiUsage } from "./usage/kimi.js";
import { getDeepseekUsage } from "./usage/deepseek.js";
import { getOpenCodeGoUsage } from "./usage/opencode-go.js";
import { getGroqUsage } from "./usage/groq.js";
import { getZedUsage } from "./usage/zed.js";
import { getXiaomiMimoUsage as getMimoDesktopUsage } from "./usage/xiaomi-mimo.js";
import { getXiaomiMimoUsage as getMimoBalanceUsage } from "./usage/xiaomiMimo.js";
import { resolveQoderCredentials } from "./qoderModels.js";
import { getGlmUsage } from "./usage/glm.js";
import {
  getIflowUsage,
  getOllamaUsage,
  getVercelAiGatewayUsage,
  getQoderUsage,
} from "./usage/misc.js";
import { getOpenRouterUsage } from "./usage/openrouter.js";
import { getCommandCodeUsage } from "./usage/commandcode.js";
import { getClinePassUsage } from "./usage/clinepass.js";
import { getAlibabaTokenPlanUsage } from "./usage/alibabaTokenPlan.js";
import { normalizeXaiUsage } from "./usage/xaiNormalize.js";

async function getXiaomiMimoCombinedUsage(c) {
  const hasBalanceSource = Boolean(c.providerSpecificData?.quotaCookie || process.env.MIMO_QUOTA_COOKIE);
  const hasDesktopSource = Boolean(c.providerSpecificData?.mimoPassToken);
  const results = await Promise.all([
    hasBalanceSource
      ? getMimoBalanceUsage(c.providerSpecificData, c.proxyOptions).catch((error) => ({ message: `MiMo balance unavailable: ${error.message}` }))
      : null,
    hasDesktopSource
      ? getMimoDesktopUsage(null, c.providerSpecificData, c.proxyOptions).catch((error) => ({ message: `MiMo Desktop unavailable: ${error.message}` }))
      : null,
  ]);
  const available = results.filter(Boolean);
  if (!available.length) return { message: "MiMo usage unavailable: no applicable account session or console cookie is configured.", quotas: {} };

  const quotas = Object.assign({}, ...available.map((result) => result.quotas || {}));
  const messages = available.map((result) => result.message).filter(Boolean);
  const plans = available.map((result) => result.plan).filter(Boolean);
  return {
    ...(plans.length ? { plan: plans.join(" + ") } : {}),
    quotas,
    ...(messages.length ? { message: messages.join("; ") } : {}),
  };
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
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions, { force: c.force }),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  kiro: (c) => getKiroUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  qoder: async (c) => {
    // PAT (pt-...) connections must be exchanged to a job token before the
    // quota endpoint accepts them.
    const resolved = await resolveQoderCredentials(c, c.proxyOptions).catch(() => null);
    return getQoderUsage(resolved?.accessToken || c.accessToken, c.proxyOptions);
  },
  iflow: (c) => getIflowUsage(c.accessToken),
  ollama: (c) => getOllamaUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  "glm-cn": (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "minimax-cn": (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "vercel-ai-gateway": (c) => getVercelAiGatewayUsage(c.apiKey, c.proxyOptions),
  "codebuddy-cn": (c) => getCodeBuddyCnUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "codebuddy-intl": (c) => getCodeBuddyIntlUsage(c.accessToken, c.apiKey, c.providerSpecificData, c.proxyOptions),
  "grok-cli": async (c) => normalizeXaiUsage(await getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions)),
  kimi: (c) => getKimiUsage(c.accessToken, c.apiKey, c.proxyOptions, c.providerSpecificData),
  "opencode-go": (c) => getOpenCodeGoUsage(c.apiKey, c.proxyOptions),
  deepseek: (c) => getDeepseekUsage(c.apiKey, c.proxyOptions),
  groq: (c) => getGroqUsage(c.apiKey, c.proxyOptions),
  zed: (c) => getZedUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  openrouter: (c) => getOpenRouterUsage(c.apiKey, c.proxyOptions),
  commandcode: (c) => getCommandCodeUsage(c.apiKey, c.proxyOptions),
  "xiaomi-mimo": (c) => getXiaomiMimoCombinedUsage(c),
  clinepass: (c) => getClinePassUsage(c.apiKey || c.accessToken, c.proxyOptions),
  // Official alitp-intl ships connection and transport but no usage API, so the
  // weekly window (no more 5h quota) is metered locally from usageHistory.
  "alitp-intl": (c) => getAlibabaTokenPlanUsage(c),
  "qwen-cloud-token-plan": (c) => getAlibabaTokenPlanUsage(c),
};

export const USAGE_IMPLEMENTED_PROVIDERS = Object.keys(USAGE_HANDLERS);

export async function getUsageForProvider(connection, proxyOptions = null, options = {}) {
  // connectionId originates from database record (connection.id or connection.connectionId)
  const connectionId = String(connection.connectionId || connection.id || "").trim();
  const { provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({
    id: connectionId,
    connectionId,
    provider,
    accessToken,
    apiKey,
    providerSpecificData,
    providerDataWithProjectId,
    proxyOptions,
    force: options.force === true,
  });
}
