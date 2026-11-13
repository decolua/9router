/**
 * Custom compatible provider credits.
 *
 * Standard interface:
 *   GET {baseUrl}{quotaPath}          (quotaPath defaults to /credits)
 *   Authorization: Bearer <apiKey>
 *   { "credits": 123.45 }             remaining credits
 *
 * Optional fields: total, used. When only credits is present the balance is
 * treated as the full amount and the usage bar stays at 100%.
 */

import { fetchWithTimeout, toFiniteNumber } from "./shared.js";

const DEFAULT_QUOTA_PATH = "/credits";
const CUSTOM_COMPATIBLE_PREFIXES = ["openai-compatible-", "anthropic-compatible-"];

export function isCustomQuotaProvider(provider) {
  if (typeof provider !== "string") return false;
  return CUSTOM_COMPATIBLE_PREFIXES.some((prefix) => provider.startsWith(prefix));
}

function normalizeQuotaPath(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_QUOTA_PATH;
  const path = value.trim();
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function appendRefresh(url) {
  return `${url}${url.includes("?") ? "&" : "?"}refresh=1`;
}

function providerLabel(providerSpecificData, data) {
  return (
    providerSpecificData?.nodeName ||
    (typeof data?.nickname === "string" && data.nickname) ||
    "Custom provider"
  );
}

/**
 * @param {Object} context
 * @param {string} context.provider
 * @param {string} context.apiKey
 * @param {Object} context.providerSpecificData
 * @param {Object|null} context.proxyOptions
 * @param {boolean} context.force
 */
export async function getCustomCreditsUsage({
  provider,
  apiKey,
  providerSpecificData,
  proxyOptions = null,
  force = false,
} = {}) {
  const psd = providerSpecificData || {};
  const baseUrl = typeof psd.baseUrl === "string" ? psd.baseUrl.trim().replace(/\/+$/, "") : "";
  if (!baseUrl) {
    return { message: `${provider}: base URL is missing.` };
  }
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: `${provider}: API key is missing.` };
  }

  const quotaPath = normalizeQuotaPath(psd.quotaPath);
  let url = /^https?:\/\//i.test(quotaPath) ? quotaPath : `${baseUrl}${quotaPath}`;
  if (force) url = appendRefresh(url);

  let response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      10000,
      proxyOptions,
    );
  } catch (error) {
    return { message: `Quota request failed: ${error.message}` };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      message: `${provider}: quota endpoint authentication failed. Check the API key.`,
    };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return {
      message: `${provider}: quota API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
    };
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { message: `${provider}: quota endpoint did not return JSON.` };
  }

  let credits = toFiniteNumber(
    data.credits ?? data.remaining ?? data.remaining_credits ?? data.balance,
    NaN,
  );
  let total = toFiniteNumber(data.total ?? data.quota_total, NaN);
  let used = toFiniteNumber(data.used ?? data.quota_used, NaN);

  if (!Number.isFinite(credits)) {
    if (Number.isFinite(total) && Number.isFinite(used)) {
      credits = total - used;
    } else {
      return {
        message: `${provider}: quota response must include a numeric credits field.`,
      };
    }
  }

  if (!Number.isFinite(total)) {
    total = Math.max(0, credits + (Number.isFinite(used) ? used : 0));
  }
  if (!Number.isFinite(used)) {
    used = Math.max(0, total - credits);
  }

  const remaining = Math.max(0, credits);
  let remainingPercentage = 0;
  if (total > 0) {
    remainingPercentage = Math.max(0, Math.min(100, (remaining / total) * 100));
  } else if (remaining > 0) {
    remainingPercentage = 100;
  }

  return {
    plan: providerLabel(psd, data),
    quotas: {
      Credits: {
        used,
        total,
        remainingPercentage,
        resetAt: null,
        unlimited: false,
        isCreditBalance: true,
        currency: "credits",
      },
    },
  };
}
