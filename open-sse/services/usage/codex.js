/**
 * Codex (OpenAI) Usage - Fetch from ChatGPT backend API
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { CODEX_CONFIG, parseResetTime } from "./utils.js";

function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getCodexRateLimitBody(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  return snapshot.rate_limit && typeof snapshot.rate_limit === "object"
    ? snapshot.rate_limit
    : snapshot;
}

function formatCodexWindow(window) {
  const used = Math.max(
    0,
    Math.min(
      100,
      toFiniteNumber(window?.used_percent ?? window?.percent_used, 0),
    ),
  );
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt: parseResetTime(
      window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null,
    ),
    unlimited: false,
  };
}

function appendCodexQuotaWindows(quotas, prefix, snapshot) {
  const rateLimit = getCodexRateLimitBody(snapshot);
  if (!rateLimit) return false;

  const primary =
    rateLimit.primary_window ||
    rateLimit.primary ||
    snapshot.primary_window ||
    snapshot.primary;
  const secondary =
    rateLimit.secondary_window ||
    rateLimit.secondary ||
    snapshot.secondary_window ||
    snapshot.secondary;
  let added = false;

  if (primary) {
    quotas[prefix ? `${prefix}_session` : "session"] =
      formatCodexWindow(primary);
    added = true;
  }
  if (secondary) {
    quotas[prefix ? `${prefix}_weekly` : "weekly"] =
      formatCodexWindow(secondary);
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
    return (
      byLimitId.code_review ||
      byLimitId.codex_review ||
      byLimitId.review ||
      null
    );
  }

  const additional = Array.isArray(data.additional_rate_limits)
    ? data.additional_rate_limits
    : [];
  return (
    additional.find((entry) => {
      const id = String(
        entry?.limit_name || entry?.metered_feature || entry?.id || "",
      ).toLowerCase();
      return (
        id === "code_review" ||
        id === "codex_review" ||
        id === "review" ||
        id.includes("review")
      );
    }) || null
  );
}

export async function getCodexUsage(accessToken, proxyOptions = null) {
  try {
    const response = await proxyAwareFetch(
      CODEX_CONFIG.usageUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (!response.ok) {
      return {
        message: `Codex connected. Usage API temporarily unavailable (${response.status}).`,
      };
    }

    const data = await response.json();
    const normalRateLimit =
      data.rate_limit ||
      data.rate_limits ||
      data.rate_limits_by_limit_id?.codex ||
      {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const quotas = {};

    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);

    return {
      plan: data.plan_type || data.summary?.plan || "unknown",
      limitReached:
        getCodexRateLimitBody(normalRateLimit)?.limit_reached || false,
      reviewLimitReached:
        getCodexRateLimitBody(reviewRateLimit)?.limit_reached || false,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Codex usage: ${error.message}`);
  }
}
