/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { CLIENT_METADATA, getPlatformUserAgent } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// GitHub API config
const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

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
  const { provider, accessToken, providerSpecificData } = connection;

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken, providerSpecificData, proxyOptions);
    case "gemini-cli":
      return await getGeminiUsage(accessToken, proxyOptions);
    case "antigravity":
      return await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    case "claude":
      return await getClaudeUsage(accessToken, proxyOptions);
    case "codex":
      return await getCodexUsage(accessToken, proxyOptions);
    case "kiro":
      return await getKiroUsage(accessToken, providerSpecificData, proxyOptions);
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    case "ollama":
      return await getOllamaUsage(accessToken);
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
function parseResetTime(resetValue) {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === 'number') {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

/**
 * GitHub Copilot Usage
 * Uses GitHub accessToken (not copilotToken) to call copilot_internal/user API
 */
async function getGitHubUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    if (!accessToken) {
      throw new Error("No GitHub access token available. Please re-authorize the connection.");
    }

    // copilot_internal/user API requires GitHub OAuth token, not copilotToken
    const response = await proxyAwareFetch("https://api.github.com/copilot_internal/user", {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
        "Editor-Version": "vscode/1.100.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    }, proxyOptions);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = await response.json();

    // Handle different response formats (paid vs free)
    if (data.quota_snapshots) {
      // Paid plan format
      const snapshots = data.quota_snapshots;
      const resetAt = parseResetTime(data.quota_reset_date);

      return {
        plan: data.copilot_plan,
        resetDate: data.quota_reset_date,
        quotas: {
          chat: { ...formatGitHubQuotaSnapshot(snapshots.chat), resetAt },
          completions: { ...formatGitHubQuotaSnapshot(snapshots.completions), resetAt },
          premium_interactions: { ...formatGitHubQuotaSnapshot(snapshots.premium_interactions), resetAt },
        },
      };
    } else if (data.monthly_quotas || data.limited_user_quotas) {
      // Free/limited plan format
      const monthlyQuotas = data.monthly_quotas || {};
      const usedQuotas = data.limited_user_quotas || {};
      const resetAt = parseResetTime(data.limited_user_reset_date);

      return {
        plan: data.copilot_plan || data.access_type_sku,
        resetDate: data.limited_user_reset_date,
        quotas: {
          chat: {
            used: usedQuotas.chat || 0,
            total: monthlyQuotas.chat || 0,
            unlimited: false,
            resetAt,
          },
          completions: {
            used: usedQuotas.completions || 0,
            total: monthlyQuotas.completions || 0,
            unlimited: false,
            resetAt,
          },
        },
      };
    }

    return { message: "GitHub Copilot connected. Unable to parse quota data." };
  } catch (error) {
    throw new Error(`Failed to fetch GitHub usage: ${error.message}`);
  }
}

function formatGitHubQuotaSnapshot(quota) {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}

/**
 * Gemini CLI Usage (Google Cloud)
 */
async function getGeminiUsage(accessToken, proxyOptions = null) {
  try {
    // Gemini CLI uses Google Cloud quotas
    // Try to get quota info from Cloud Resource Manager
    const response = await proxyAwareFetch(
      "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions
    );

    if (!response.ok) {
      // Quota API may not be accessible, return generic message
      return { message: "Gemini CLI uses Google Cloud quotas. Check Google Cloud Console for details." };
    }

    return { message: "Gemini CLI connected. Usage tracked via Google Cloud Console." };
  } catch (error) {
    return { message: "Unable to fetch Gemini usage. Check Google Cloud Console." };
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    // Fetch quota data with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    let response;
    try {
      response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.quotaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": "1.107.0",
          "x-request-source": "local", // MITM bypass
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {})
        }),
        signal: controller.signal,
      }, proxyOptions);
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas = {};

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'claude-opus-4-6-thinking',
        'claude-sonnet-4-6',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-3-flash',
        'gpt-oss-120b-medium',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
        };
      }
    }

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Get Antigravity project ID from subscription info
 */
async function getAntigravityProjectId(accessToken) {
  try {
    const info = await getAntigravitySubscriptionInfo(accessToken);
    return info?.cloudaicompanionProject || null;
  } catch {
    return null;
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const response = await proxyAwareFetch(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "x-request-source": "local", // MITM bypass
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
      signal: controller.signal,
    }, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Claude Usage - Primary: OAuth endpoint, Fallback: legacy settings/org endpoint
 */
async function getClaudeUsage(accessToken, proxyOptions = null) {
  try {
    // Primary: OAuth usage endpoint (Claude Code consumer OAuth tokens)
    const oauthResponse = await proxyAwareFetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas = {};

      // utilization = % USED (e.g. 87 means 87% used, 13% remaining)
      const hasUtilization = (window) =>
        window && typeof window === "object" && typeof window.utilization === "number";

      const createQuotaObject = (window) => {
        const used = window.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(window.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

      // Parse model-specific weekly windows (e.g. seven_day_sonnet, seven_day_opus)
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("seven_day_") && key !== "seven_day" && hasUtilization(value)) {
          const modelName = key.replace("seven_day_", "");
          quotas[`weekly ${modelName} (7d)`] = createQuotaObject(value);
        }
      }

      return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas,
      };
    }

    // Fallback: legacy settings + org usage endpoint
    console.warn(`[Claude Usage] OAuth endpoint returned ${oauthResponse.status}, falling back to legacy`);
    return await getClaudeUsageLegacy(accessToken, proxyOptions);
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

/**
 * Legacy Claude usage for API key / org admin users
 */
async function getClaudeUsageLegacy(accessToken, proxyOptions = null) {
  try {
    const settingsResponse = await proxyAwareFetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    }, proxyOptions);

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await proxyAwareFetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          },
          proxyOptions
        );

        if (usageResponse.ok) {
          const usage = await usageResponse.json();
          return {
            plan: settings.plan || "Unknown",
            organization: settings.organization_name,
            quotas: usage,
          };
        }
      }

      return {
        plan: settings.plan || "Unknown",
        organization: settings.organization_name,
        message: "Claude connected. Usage details require admin access.",
      };
    }

    return { message: "Claude connected. Usage API requires admin permissions." };
  } catch (error) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

/**
 * Codex (OpenAI) Usage - Fetch from ChatGPT backend API
 */
async function getCodexUsage(accessToken, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();

    // Parse rate limit info
    const rateLimit = data.rate_limit || {};
    const primaryWindow = rateLimit.primary_window || {};
    const secondaryWindow = rateLimit.secondary_window || {};

    // Parse reset dates (reset_at is Unix timestamp in seconds, multiply by 1000 for ms)
    const sessionResetAt = parseResetTime(primaryWindow.reset_at ? primaryWindow.reset_at * 1000 : null);
    const weeklyResetAt = parseResetTime(secondaryWindow.reset_at ? secondaryWindow.reset_at * 1000 : null);

    return {
      plan: data.plan_type || "unknown",
      limitReached: rateLimit.limit_reached || false,
      quotas: {
        session: {
          used: primaryWindow.used_percent || 0,
          total: 100,
          remaining: 100 - (primaryWindow.used_percent || 0),
          resetAt: sessionResetAt,
          unlimited: false,
        },
        weekly: {
          used: secondaryWindow.used_percent || 0,
          total: 100,
          remaining: 100 - (secondaryWindow.used_percent || 0),
          resetAt: weeklyResetAt,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

/**
 * Kiro (AWS CodeWhisperer) Usage
 */
function parseKiroQuotaData(data) {
  const usageList = data.usageBreakdownList || [];
  const quotaInfo = {};
  const resetAt = parseResetTime(data.nextDateReset || data.resetDate);

  usageList.forEach((breakdown) => {
    const resourceType = breakdown.resourceType?.toLowerCase() || "unknown";
    const used = breakdown.currentUsageWithPrecision || 0;
    const total = breakdown.usageLimitWithPrecision || 0;

    quotaInfo[resourceType] = {
      used,
      total,
      remaining: total - used,
      resetAt,
      unlimited: false,
    };

    // Add free trial if available
    if (breakdown.freeTrialInfo) {
      const freeUsed = breakdown.freeTrialInfo.currentUsageWithPrecision || 0;
      const freeTotal = breakdown.freeTrialInfo.usageLimitWithPrecision || 0;

      quotaInfo[`${resourceType}_freetrial`] = {
        used: freeUsed,
        total: freeTotal,
        remaining: freeTotal - freeUsed,
        resetAt: parseResetTime(breakdown.freeTrialInfo.freeTrialExpiry || resetAt),
        unlimited: false,
      };
    }
  });

  return {
    plan: data.subscriptionInfo?.subscriptionTitle || "Kiro",
    quotas: quotaInfo,
  };
}

async function getKiroUsage(accessToken, providerSpecificData, proxyOptions = null) {
  // Default profileArn fallback
  const DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
  const profileArn = providerSpecificData?.profileArn || DEFAULT_PROFILE_ARN;
  const authMethod = providerSpecificData?.authMethod || "builder-id";

  const getUsageParams = new URLSearchParams({
    isEmailRequired: "true",
    origin: "AI_EDITOR",
    resourceType: "AGENTIC_REQUEST",
  });

  // For compatibility, try multiple known Kiro usage endpoints
  const attempts = [
    {
      name: "codewhisperer-get",
      run: async () => proxyAwareFetch(
        `https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?${getUsageParams.toString()}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
            "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE",
            "user-agent": "aws-sdk-js/1.0.0 KiroIDE",
          },
        },
        proxyOptions
      ),
    },
    {
      name: "codewhisperer-post",
      run: async () => proxyAwareFetch("https://codewhisperer.us-east-1.amazonaws.com", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        }),
      }, proxyOptions),
    },
    {
      name: "q-get",
      run: async () => {
        const params = new URLSearchParams({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        });
        return proxyAwareFetch(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        }, proxyOptions);
      },
    },
  ];

  let sawAuthError = false;
  const errors = [];

  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          sawAuthError = true;
        }
        errors.push(`${attempt.name}:${response.status}${errorText ? `:${errorText}` : ""}`);
        continue;
      }

      const data = await response.json();
      return parseKiroQuotaData(data);
    } catch (error) {
      errors.push(`${attempt.name}:${error.message}`);
    }
  }

  if (sawAuthError && authMethod === "idc") {
    return {
      message: "Kiro quota API is unavailable for the current AWS IAM Identity Center session. Chat may still work. If this persists after renewing your session, reconnect Kiro.",
      quotas: {},
    };
  }

  // Social auth (Google/GitHub) - these use a different token format that may not work with AWS CodeWhisperer quota APIs
  if (sawAuthError && (authMethod === "google" || authMethod === "github")) {
    return {
      message: "Kiro quota API authentication expired. Chat may still work.",
      quotas: {},
    };
  }

  if (sawAuthError) {
    return {
      message: "Kiro quota API rejected the current token. Chat may still work.",
      quotas: {},
    };
  }

  const fallbackMessage =
    errors.length > 0
      ? `Unable to fetch Kiro usage right now. (${errors[errors.length - 1]})`
      : "Unable to fetch Kiro usage right now.";

  return {
    message: fallbackMessage,
    quotas: {},
  };
}

/**
 * Qwen Usage
 */
async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud Usage
 * Ollama Cloud uses an API key from ollama.com/settings/keys
 * and has no public usage API — free tier has light usage limits (resets every 5h & 7d).
 * This returns an informational message with the plan details.
 */
async function getOllamaUsage(accessToken, providerSpecificData) {
  try {
    // Ollama Cloud does not expose a public quota/usage API.
    // The provider is configured as noAuth with a notice explaining limits.
    // We return a graceful message so the UI shows a friendly state instead of an error.
    const plan = providerSpecificData?.plan || "Free";
    return {
      plan,
      message: "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
      quotas: [],
    };
  } catch (error) {
    return { message: "Unable to fetch Ollama Cloud usage." };
  }
}
