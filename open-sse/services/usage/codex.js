/**
 * Codex (OpenAI) usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: U("codex").url,
  resetCreditsUrl: U("codex").resetCreditsUrl,
  resetCreditsConsumeUrl: U("codex").resetCreditsConsumeUrl,
};

const RESET_CREDIT_ARRAY_KEYS = [
  "credits",
  "available_credits",
  "availableCredits",
  "reset_credits",
  "resetCredits",
  "items",
  "grants",
];

const RESET_CREDIT_EXPIRY_KEYS = [
  "expires_at",
  "expiresAt",
  "expiration_time",
  "expirationTime",
  "expiry",
  "expiry_at",
  "expiryAt",
  "valid_until",
  "validUntil",
];

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  const time = date.getTime();
  return Number.isFinite(time) ? date.toISOString() : null;
}

function getCodexAccountId(providerSpecificData) {
  return providerSpecificData?.workspaceId || providerSpecificData?.accountId || providerSpecificData?.chatgptAccountId || null;
}

function firstArrayField(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  return [];
}

function firstParsedResetTime(source, keys) {
  for (const key of keys) {
    const parsed = parseResetTime(source?.[key]) || toIsoDate(source?.[key]);
    if (parsed) return parsed;
  }
  return null;
}

function isAvailableResetCredit(credit) {
  if (!credit || typeof credit !== "object") return false;
  if (credit.used_at || credit.consumed_at || credit.redeemed_at) return false;
  const status = String(credit.status || credit.state || "").toLowerCase();
  return !["used", "consumed", "redeemed", "expired", "inactive"].includes(status);
}

export function parseCodexResetCredits(resetCredits) {
  if (!resetCredits || typeof resetCredits !== "object" || Array.isArray(resetCredits)) {
    return { availableCount: 0, credits: [] };
  }

  const credits = firstArrayField(resetCredits, RESET_CREDIT_ARRAY_KEYS)
    .filter(isAvailableResetCredit)
    .map((credit, index) => ({
      id: credit.id || credit.credit_id || credit.reset_credit_id || null,
      index,
      status: String(credit.status || credit.state || "available"),
      grantedAt: toIsoDate(credit.granted_at ?? credit.grantedAt),
      expiresAt: firstParsedResetTime(credit, RESET_CREDIT_EXPIRY_KEYS),
      type: credit.type || credit.kind || null,
    }));
  const countValue = resetCredits.available_count
    ?? resetCredits.availableCount
    ?? resetCredits.count
    ?? resetCredits.total_available
    ?? resetCredits.totalAvailable;
  const count = toFiniteNumber(countValue, Number.NaN);
  const availableCount = Number.isFinite(count) ? Math.max(0, count) : credits.length;

  return {
    availableCount,
    credits: credits.slice(0, availableCount),
  };
}

function getCodexRateLimitBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return snapshot.rate_limit && typeof snapshot.rate_limit === "object"
    ? snapshot.rate_limit
    : snapshot;
}

function formatCodexWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.used_percent ?? window?.percent_used, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas, prefix, snapshot) {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const primary = rateLimit.primary_window || rateLimit.primary || snapshot.primary_window || snapshot.primary;
  const secondary = rateLimit.secondary_window || rateLimit.secondary || snapshot.secondary_window || snapshot.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
    added = true;
  }

  return added;
}

function getCodexReviewRateLimit(data) {
  if (data.code_review_rate_limit || data.review_rate_limit) {
    return data.code_review_rate_limit || data.review_rate_limit;
  }

  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId.code_review || byLimitId.codex_review || byLimitId.review || null;
  }

  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((entry) => {
    const id = String(entry?.limit_name || entry?.metered_feature || entry?.id || "").toLowerCase();
    return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
  }) || null;
}

export async function getCodexUsage(accessToken, proxyOptions = null) {
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
    const normalRateLimit = data.rate_limit || data.rate_limits || data.rate_limits_by_limit_id?.codex || {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const resetCredits = parseCodexResetCredits(data.rate_limit_reset_credits);
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      resetCredits,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}

export async function getCodexRateLimitResetCredits(accessToken, proxyOptions = null, providerSpecificData = null) {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }

  const accountId = getCodexAccountId(providerSpecificData);
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept": "application/json",
    "OpenAI-Beta": "codex-1",
    "originator": "codex_cli_rs",
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;

  const response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsUrl, {
    method: "GET",
    headers,
  }, proxyOptions);

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail || `Codex reset credits API unavailable (${response.status}).`;
    throw new Error(message);
  }

  return parseCodexResetCredits(data);
}

// Consume one Codex rate-limit reset credit (irreversible, spends 1 credit)
export async function consumeCodexRateLimitResetCredit(accessToken, redeemRequestId, proxyOptions = null) {
  if (!accessToken) {
    throw new Error("No Codex access token available. Please re-authorize the connection.");
  }
  if (!redeemRequestId || typeof redeemRequestId !== "string") {
    throw new Error("A redeem request id is required to consume a Codex reset credit.");
  }

  let response;
  let data = null;
  try {
    response = await proxyAwareFetch(CODEX_CONFIG.resetCreditsConsumeUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redeem_request_id: redeemRequestId }),
    }, proxyOptions);

    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to consume Codex reset credit: ${error.message}`);
  }

  const code = data?.code || null;
  const windowsReset = toFiniteNumber(data?.windows_reset, 0);
  const success = response.ok && (code === "reset" || windowsReset > 0);

  return {
    ok: success,
    noCredit: response.ok && code === "no_credit",
    status: response.status,
    code,
    windowsReset,
    message: data?.message || null,
    raw: data,
  };
}
