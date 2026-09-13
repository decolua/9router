/**
 * GitHub Copilot usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDER_OAUTH } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

// GitHub API config — single source from registry oauth block
const GITHUB_CONFIG = {
  apiVersion: PROVIDER_OAUTH.github?.apiVersion,
  userAgent: PROVIDER_OAUTH.github?.userAgent,
};

/**
 * GitHub Copilot Usage
 * Uses GitHub accessToken (not copilotToken) to call copilot_internal/user API
 */
export async function getGitHubUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    if (!accessToken) {
      throw new Error("No GitHub access token available. Please re-authorize the connection.");
    }

    // copilot_internal/user API requires GitHub OAuth token, not copilotToken
    const response = await proxyAwareFetch(U("github").url, {
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
      const creditLimit = providerSpecificData?.aiCreditLimit;
      const creditsUsed = parseQuotaNumber(snapshots.premium_interactions?.credits_used);

      return {
        plan: data.copilot_plan,
        tokenBasedBilling: data.token_based_billing === true,
        resetDate: data.quota_reset_date,
        quotas: {
          chat: formatGitHubQuotaSnapshot(snapshots.chat, resetAt),
          completions: formatGitHubQuotaSnapshot(snapshots.completions, resetAt),
          premium_interactions: {
            ...formatGitHubQuotaSnapshot(snapshots.premium_interactions, resetAt),
            ...(data.token_based_billing ? { displayName: "AI Credits", unit: "AI Credits" } : {}),
          },
          ...(typeof creditLimit === "number" && Number.isFinite(creditLimit) && creditLimit >= 0 && creditsUsed !== undefined ? {
            ai_credit_limit: {
              displayName: "Local AI Credits limit",
              unit: "AI Credits",
              used: creditsUsed,
              total: creditLimit,
              unlimited: false,
              remainingPercentage: creditLimit > 0 ? Math.max(0, (1 - creditsUsed / creditLimit) * 100) : 0,
              resetAt: parseResetTime(snapshots.premium_interactions?.quota_reset_at) || resetAt,
            },
          } : {}),
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

function parseQuotaNumber(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function formatGitHubQuotaSnapshot(quota, resetAt) {
  if (!quota) return { used: 0, total: 0, unlimited: true, resetAt };

  const total = parseQuotaNumber(quota.entitlement) ?? 0;
  const remaining = parseQuotaNumber(quota.quota_remaining) ?? parseQuotaNumber(quota.remaining);
  const remainingPercentage = parseQuotaNumber(quota.percent_remaining);
  const creditsUsed = parseQuotaNumber(quota.credits_used);
  const used = remaining !== undefined
    ? Math.max(0, total - remaining)
    : total * (1 - Math.min(remainingPercentage ?? 100, 100) / 100);

  return {
    used,
    total,
    remaining,
    unlimited: quota.unlimited || false,
    ...(remainingPercentage !== undefined ? { remainingPercentage: Math.min(remainingPercentage, 100) } : {}),
    ...(creditsUsed !== undefined ? { creditsUsed } : {}),
    resetAt: parseResetTime(quota.quota_reset_at) || resetAt,
  };
}
