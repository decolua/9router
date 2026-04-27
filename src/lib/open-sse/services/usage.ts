/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { CLIENT_METADATA, getPlatformUserAgent } from "../config/appConstants";

// GitHub API config
const GITHUB_CONFIG = {
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

// Antigravity API config
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

export interface QuotaInfo {
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt?: string | null;
  unlimited: boolean;
  displayName?: string;
}

export interface ProviderUsageResult {
  plan?: string;
  resetDate?: string;
  quotas?: Record<string, QuotaInfo | any>;
  message?: string;
  extraUsage?: any;
  organization?: string;
  limitReached?: boolean;
  subscriptionInfo?: any;
}

/**
 * Get usage data for a provider connection
 */
export async function getUsageForProvider(connection: any): Promise<ProviderUsageResult> {
  const { provider, accessToken, providerSpecificData } = connection;

  switch (provider) {
    case "github":
      return await getGitHubUsage(accessToken, providerSpecificData);
    case "gemini-cli":
      return await getGeminiUsage(accessToken);
    case "antigravity":
      return await getAntigravityUsage(accessToken, providerSpecificData);
    case "claude":
      return await getClaudeUsage(accessToken);
    case "codex":
      return await getCodexUsage(accessToken);
    case "kiro":
      return await getKiroUsage(accessToken, providerSpecificData);
    case "qwen":
      return await getQwenUsage(accessToken, providerSpecificData);
    case "iflow":
      return await getIflowUsage(accessToken);
    default:
      return { message: `Usage API not implemented for ${provider}` };
  }
}

function parseResetTime(resetValue: any): string | null {
  if (!resetValue) return null;

  try {
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }
    if (typeof resetValue === 'number') {
      return new Date(resetValue).toISOString();
    }
    if (typeof resetValue === 'string') {
      return new Date(resetValue).toISOString();
    }
    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

async function getGitHubUsage(accessToken: string, providerSpecificData: any): Promise<ProviderUsageResult> {
  try {
    if (!accessToken) {
      throw new Error("No GitHub access token available.");
    }

    const response = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/json",
        "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        "User-Agent": GITHUB_CONFIG.userAgent,
        "Editor-Version": "vscode/1.100.0",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const data = await response.json();

    if (data.quota_snapshots) {
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
  } catch (error: any) {
    throw new Error(`Failed to fetch GitHub usage: ${error.message}`);
  }
}

function formatGitHubQuotaSnapshot(quota: any): QuotaInfo {
  if (!quota) return { used: 0, total: 0, unlimited: true };

  return {
    used: quota.entitlement - quota.remaining,
    total: quota.entitlement,
    remaining: quota.remaining,
    unlimited: quota.unlimited || false,
  };
}

async function getGeminiUsage(accessToken: string): Promise<ProviderUsageResult> {
  try {
    const response = await fetch(
      "https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return { message: "Gemini CLI uses Google Cloud quotas. Check Google Cloud Console for details." };
    }

    return { message: "Gemini CLI connected. Usage tracked via Google Cloud Console." };
  } catch (error) {
    return { message: "Unable to fetch Gemini usage. Check Google Cloud Console." };
  }
}

async function getAntigravityUsage(accessToken: string, providerSpecificData: any): Promise<ProviderUsageResult> {
  try {
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(ANTIGRAVITY_CONFIG.quotaApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": "1.107.0",
          "x-request-source": "local",
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {})
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 403) {
      return { message: "Antigravity quota API access forbidden.", quotas: {} };
    }

    if (response.status === 401) {
      return { message: "Antigravity quota API authentication expired.", quotas: {} };
    }

    if (!response.ok) {
      throw new Error(`Antigravity API error: ${response.status}`);
    }

    const data = await response.json();
    const quotas: Record<string, QuotaInfo> = {};

    if (data.models) {
      const importantModels = [
        'claude-opus-4-6-thinking',
        'claude-sonnet-4-6',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-3-flash',
        'gpt-oss-120b-medium',
      ];

      for (const [modelKey, info] of Object.entries(data.models) as [string, any][]) {
        if (!info.quotaInfo) continue;
        if (info.isInternal || !importantModels.includes(modelKey)) continue;

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const total = 1000;
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage: remainingFraction * 100,
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
  } catch (error: any) {
    console.error("[Antigravity Usage] Error:", error.message);
    return { message: `Antigravity error: ${error.message}` };
  }
}

async function getAntigravitySubscriptionInfo(accessToken: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "x-request-source": "local",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (error: any) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getClaudeUsage(accessToken: string): Promise<ProviderUsageResult> {
  try {
    const oauthResponse = await fetch(CLAUDE_CONFIG.oauthUsageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    });

    if (oauthResponse.ok) {
      const data = await oauthResponse.json();
      const quotas: Record<string, QuotaInfo> = {};

      const hasUtilization = (win: any) =>
        win && typeof win === "object" && typeof win.utilization === "number";

      const createQuotaObject = (win: any): QuotaInfo => {
        const used = win.utilization;
        const remaining = Math.max(0, 100 - used);
        return {
          used,
          total: 100,
          remaining,
          remainingPercentage: remaining,
          resetAt: parseResetTime(win.resets_at),
          unlimited: false,
        };
      };

      if (hasUtilization(data.five_hour)) {
        quotas["session (5h)"] = createQuotaObject(data.five_hour);
      }

      if (hasUtilization(data.seven_day)) {
        quotas["weekly (7d)"] = createQuotaObject(data.seven_day);
      }

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

    return await getClaudeUsageLegacy(accessToken);
  } catch (error: any) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getClaudeUsageLegacy(accessToken: string): Promise<ProviderUsageResult> {
  try {
    const settingsResponse = await fetch(CLAUDE_CONFIG.settingsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-version": CLAUDE_CONFIG.apiVersion,
      },
    });

    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();

      if (settings.organization_id) {
        const usageResponse = await fetch(
          CLAUDE_CONFIG.usageUrl.replace("{org_id}", settings.organization_id),
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "anthropic-version": CLAUDE_CONFIG.apiVersion,
            },
          }
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
  } catch (error: any) {
    return { message: `Claude connected. Unable to fetch usage: ${error.message}` };
  }
}

async function getCodexUsage(accessToken: string): Promise<ProviderUsageResult> {
  try {
    const response = await fetch(CODEX_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const rateLimit = data.rate_limit || {};
    const primaryWindow = rateLimit.primary_window || null;
    const secondaryWindow = rateLimit.secondary_window || null;

    const quotas: Record<string, QuotaInfo> = {};

    if (primaryWindow) {
      const resetAt = parseResetTime(primaryWindow.reset_at ? primaryWindow.reset_at * 1000 : null);
      quotas[secondaryWindow ? "session" : "primary"] = {
        used: primaryWindow.used_percent || 0,
        total: 100,
        remaining: 100 - (primaryWindow.used_percent || 0),
        resetAt,
        unlimited: false,
      };
    }

    if (secondaryWindow) {
      const resetAt = parseResetTime(secondaryWindow.reset_at ? secondaryWindow.reset_at * 1000 : null);
      quotas["weekly"] = {
        used: secondaryWindow.used_percent || 0,
        total: 100,
        remaining: 100 - (secondaryWindow.used_percent || 0),
        resetAt,
        unlimited: false,
      };
    }

    return {
      plan: data.plan_type || "unknown",
      limitReached: rateLimit.limit_reached || false,
      quotas,
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

function parseKiroQuotaData(data: any): ProviderUsageResult {
  const usageList = data.usageBreakdownList || [];
  const quotaInfo: Record<string, QuotaInfo> = {};
  const resetAt = parseResetTime(data.nextDateReset || data.resetDate);

  usageList.forEach((breakdown: any) => {
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

async function getKiroUsage(accessToken: string, providerSpecificData: any): Promise<ProviderUsageResult> {
  const DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
  const profileArn = providerSpecificData?.profileArn || DEFAULT_PROFILE_ARN;
  const authMethod = providerSpecificData?.authMethod || "builder-id";

  const getUsageParams = new URLSearchParams({
    isEmailRequired: "true",
    origin: "AI_EDITOR",
    resourceType: "AGENTIC_REQUEST",
  });

  const attempts = [
    {
      name: "codewhisperer-get",
      run: async () => fetch(
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
      ),
    },
    {
      name: "codewhisperer-post",
      run: async () => fetch("https://codewhisperer.us-east-1.amazonaws.com", {
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
      }),
    },
    {
      name: "q-get",
      run: async () => {
        const params = new URLSearchParams({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        });
        return fetch(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        });
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
    } catch (error: any) {
      errors.push(`${attempt.name}:${error.message}`);
    }
  }

  if (sawAuthError && authMethod === "idc") {
    return { message: "Kiro quota API is unavailable for IDC session.", quotas: {} };
  }

  if (sawAuthError && (authMethod === "google" || authMethod === "github")) {
    return { message: "Kiro quota API authentication expired.", quotas: {} };
  }

  if (sawAuthError) {
    return { message: "Kiro quota API rejected the current token.", quotas: {} };
  }

  const fallbackMessage =
    errors.length > 0
      ? `Unable to fetch Kiro usage right now. (${errors[errors.length - 1]})`
      : "Unable to fetch Kiro usage right now.";

  return { message: fallbackMessage, quotas: {} };
}

async function getQwenUsage(accessToken: string, providerSpecificData: any): Promise<ProviderUsageResult> {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

async function getIflowUsage(accessToken: string): Promise<ProviderUsageResult> {
  try {
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}
