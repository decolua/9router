/**
 * Xiaomi MiMo usage — weekly quota from the Xiaomi account session.
 *
 * Primary path: GET {mimo-server}/api/user/usage authorized by the account-session
 * cookie (see shared/mimoAccount.js). Response: { code: 0, data: { percent (remaining
 * %), resetDate, resetAt } }.
 *
 * Fallback: the sk- API key cannot read the quota, so when no account session is
 * available we surface a graceful message instead of failing.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { getMimoAccountUsage } from "../../shared/mimoAccount.js";

const USAGE_URL = "https://aistudio.xiaomimimo.com/open-apis/v1/user/usage";

/**
 * @param {string|null|undefined} accessToken - sk- API key
 * @param {object|null} providerSpecificData - may contain mimoPassToken, uid, etc.
 * @param {object|null} proxyOptions
 */
export async function getXiaomiMimoUsage(accessToken = null, providerSpecificData = null, proxyOptions = null) {
  // Preferred path: the weekly quota comes from the account service session
  // (mimo-server /api/user/usage), which the sk- key cannot reach. The session is
  // derived from MiMo Desktop's persisted passToken via the SSO/sts handshake.
  const account = await getMimoAccountUsage(providerSpecificData, proxyOptions);
  if (typeof account.percent === "number" && Number.isFinite(account.percent)) {
    const remaining = Math.max(0, Math.min(100, Math.round(account.percent)));
    const used = 100 - remaining;
    let resetAt = null;
    if (typeof account.resetAt === "number" && account.resetAt > 0) {
      resetAt = new Date(account.resetAt * 1000).toISOString();
    } else if (typeof account.resetDate === "string") {
      const parsed = new Date(`${account.resetDate}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) resetAt = parsed.toISOString();
    }
    return {
      plan: "Xiaomi MiMo Desktop",
      quotas: {
        Weekly: { used, total: 100, remainingPercentage: remaining, resetAt, unlimited: false },
      },
    };
  }

  // Fallback: no account session available (Desktop never logged in, or its cookie
  // store is locked). The sk- key cannot read the quota, so surface a clear message.
  const key = accessToken || providerSpecificData?.apiKey;
  if (!key || typeof key !== "string" || !key.trim()) {
    return { message: "Xiaomi MiMo Desktop not connected. Add credentials to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          "X-Mimo-Source": "mimocode-cli",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
      proxyOptions,
    );

    if (response.status === 401) {
      return {
        plan: "Xiaomi MiMo Desktop",
        message: "Weekly quota requires Xiaomi account session. API key alone is insufficient.",
      };
    }

    if (!response.ok) {
      return {
        plan: "Xiaomi MiMo Desktop",
        message: `Usage API error (${response.status})`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || data.code !== 0 || !data.data) {
      return {
        plan: "Xiaomi MiMo Desktop",
        message: "Usage endpoint returned unexpected response.",
      };
    }

    const { percent, resetDate } = data.data;
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
      return {
        plan: "Xiaomi MiMo Desktop",
        message: "Usage data missing percent field.",
      };
    }

    // percent = remaining percentage (e.g. 94 means 94% remaining)
    const remaining = Math.max(0, Math.min(100, Math.round(percent)));
    const used = 100 - remaining;

    // Parse resetDate — expected format "2026-09-16"
    let resetAt = null;
    if (resetDate && typeof resetDate === "string") {
      const parsed = new Date(`${resetDate}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) {
        resetAt = parsed.toISOString();
      }
    }

    return {
      plan: "Xiaomi MiMo Desktop",
      quotas: {
        Weekly: {
          used,
          total: 100,
          remainingPercentage: remaining,
          resetAt,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Xiaomi MiMo Desktop usage error: ${error.message}` };
  }
}
