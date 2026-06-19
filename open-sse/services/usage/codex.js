/**
 * Codex (OpenAI) usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

// Codex (OpenAI) API config
const CODEX_CONFIG = {
  usageUrl: U("codex").url,
  resetCreditsConsumeUrl: U("codex").resetCreditsConsumeUrl,
};

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
    const availableResetCredits = Math.max(0, toFiniteNumber(data.rate_limit_reset_credits?.available_count, 0));
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      resetCredits: { availableCount: availableResetCredits },
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
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
