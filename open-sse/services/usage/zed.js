/**
 * Zed usage — GET https://cloud.zed.dev/client/users/me
 * Auth: Authorization: {user_id} {access_token}
 *
 * Quota rows are derived from plan.usage (edit_predictions, optional model_requests)
 * and subscription_period.ended_at for billing-cycle reset.
 */

import { fetchZedAuthenticatedUser } from "../../shared/zedAuth.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

/** Map plan_v3 ids to dashboard labels (CodexBar-compatible). */
export function formatZedPlanLabel(rawPlan) {
  const raw = String(rawPlan || "").trim();
  if (!raw) return "Zed";
  switch (raw.toLowerCase()) {
    case "zed_free":
      return "Zed Free";
    case "zed_pro":
      return "Zed Pro";
    case "zed_pro_trial":
      return "Zed Pro Trial";
    case "zed_student":
      return "Zed Student";
    case "zed_business":
      return "Zed Business";
    default:
      return raw
        .replace(/_/g, " ")
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
  }
}

/**
 * Parse Zed UsageLimit JSON: "unlimited", a number, or { limited: N }.
 */
export function parseZedUsageLimit(limit) {
  if (limit == null) return { unlimited: false, total: 0 };

  if (limit === "unlimited" || limit?.unlimited === true) {
    return { unlimited: true, total: 0 };
  }

  if (typeof limit === "number" && Number.isFinite(limit)) {
    return { unlimited: false, total: Math.max(0, limit) };
  }

  if (typeof limit === "string") {
    const trimmed = limit.trim();
    if (trimmed === "unlimited") return { unlimited: true, total: 0 };
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return { unlimited: false, total: Math.max(0, parsed) };
  }

  const limited = limit.limited ?? limit.Limited;
  if (typeof limited === "number" && Number.isFinite(limited)) {
    return { unlimited: false, total: Math.max(0, limited) };
  }

  return { unlimited: false, total: 0 };
}

/** limit `{ limited: 0 }` on Pro/Student means token billing, not a 0-cap request quota. */
export function isZedTokenBillingModelRequestsLimit(limitRaw) {
  const info = parseZedUsageLimit(limitRaw);
  return !info.unlimited && info.total === 0;
}

function makeZedQuotaRow(name, usedRaw, limitRaw, resetAt = null) {
  const used = Math.max(0, toFiniteNumber(usedRaw, 0));
  const limitInfo = parseZedUsageLimit(limitRaw);

  if (limitInfo.unlimited) {
    return {
      used,
      total: 0,
      remainingPercentage: 100,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }

  const total = limitInfo.total;
  if (total <= 0) {
    return {
      used,
      total: 0,
      remainingPercentage: 0,
      resetAt: resetAt || null,
      unlimited: false,
    };
  }

  const clampedUsed = Math.min(used, total);
  const remaining = Math.max(0, total - clampedUsed);
  return {
    used: clampedUsed,
    total,
    remainingPercentage: (remaining / total) * 100,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

function usageBucketLimit(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  if (bucket.limit != null) return bucket.limit;
  return bucket;
}

/**
 * Map /client/users/me JSON → { plan, quotas, message } for the dashboard.
 */
export function parseZedAuthenticatedUserUsage(userInfo) {
  const plan = userInfo?.plan || {};
  const planId =
    plan.plan_v3 || plan.plan_v2 || plan.plan || userInfo?.plan_v3 || null;
  const resetAt =
    parseResetTime(plan.subscription_period?.ended_at) ||
    parseResetTime(plan.subscriptionPeriod?.endedAt) ||
    null;

  const quotas = {};
  const usage = plan.usage || {};

  const editPredictions = usage.edit_predictions || usage.editPredictions;
  if (editPredictions) {
    quotas["Edit Predictions"] = makeZedQuotaRow(
      "Edit Predictions",
      editPredictions.used,
      editPredictions.limit,
      resetAt,
    );
  }

  const modelRequests = usage.model_requests || usage.modelRequests;
  if (modelRequests) {
    const limitRaw =
      modelRequests.limit != null
        ? modelRequests.limit
        : usageBucketLimit(modelRequests)?.limit;
    const limitInfo = parseZedUsageLimit(limitRaw);
    // Token-billed plans report model_requests.limit=0 — not a request quota.
    if (limitInfo.unlimited || limitInfo.total > 0) {
      quotas["Hosted Model Requests"] = makeZedQuotaRow(
        "Hosted Model Requests",
        modelRequests.used,
        limitRaw,
        resetAt,
      );
    }
  }

  const tokenBillingNote =
    modelRequests &&
    isZedTokenBillingModelRequestsLimit(
      modelRequests.limit ?? usageBucketLimit(modelRequests)?.limit,
    )
      ? "Hosted AI models are billed per token (not request count). Edit Predictions are tracked below. Token spend is on dashboard.zed.dev."
      : null;

  let planLabel = formatZedPlanLabel(planId);
  if (plan.trial_started_at || plan.trialStartedAt) {
    if (!/trial/i.test(planLabel)) planLabel = `${planLabel} (Trial active)`;
  }

  let message = tokenBillingNote;
  if (plan.has_overdue_invoices || plan.hasOverdueInvoices) {
    message = "This Zed account has overdue invoices. Usage may be blocked until billing is resolved.";
  }

  return {
    plan: planLabel,
    quotas,
    message,
    hasOverdueInvoices: !!(plan.has_overdue_invoices || plan.hasOverdueInvoices),
    trialStarted: !!(plan.trial_started_at || plan.trialStartedAt),
    planId: planId || null,
    resetAt,
  };
}

/**
 * @param {string|null|undefined} accessToken
 * @param {object|null|undefined} providerSpecificData
 * @param {object|null|undefined} proxyOptions
 */
export async function getZedUsage(
  accessToken = null,
  providerSpecificData = {},
  proxyOptions = null,
) {
  const psd = providerSpecificData || {};
  const userId = psd.userId;

  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    return { message: "Zed access token not available. Re-connect Zed to view quota." };
  }
  if (!userId) {
    return { message: "Zed credential is missing user id. Re-connect Zed to view quota." };
  }

  const credentials = {
    accessToken: accessToken.trim(),
    providerSpecificData: psd,
  };

  try {
    const userInfo = await fetchZedAuthenticatedUser(credentials, { proxyOptions });
    return parseZedAuthenticatedUserUsage(userInfo);
  } catch (error) {
    const status = error?.status;
    if (status === 401 || status === 403) {
      return {
        message: "Zed authentication failed. Sign in again from the dashboard or Zed editor.",
      };
    }
    return { message: `Zed error: ${error.message || "Failed to fetch quota"}` };
  }
}
