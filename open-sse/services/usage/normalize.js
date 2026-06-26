import { getModelsByProviderId } from "../../config/providerModels.js";

/**
 * Parse provider-specific quota structures into a normalized array.
 *
 * Shared between the dashboard client (display) and the backend usage route
 * (persistence): the backend stores the result as `quotaInfos` on each
 * connection so the connection list can ship last-known quota to the UI
 * without waiting for a live refetch.
 *
 * @param {string} provider - Provider name (github, antigravity, codex, kiro, claude, ...)
 * @param {Object} data - Raw quota data from provider
 * @returns {Array<Object>} Normalized quota objects with { name, used, total, resetAt }
 */
export function parseQuotaData(provider, data) {
  if (!data || typeof data !== "object") return [];

  const normalizedQuotas = [];

  try {
    switch (provider.toLowerCase()) {
      case "github":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "antigravity":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey: modelKey, // Keep modelKey for sorting
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          });
        }
        break;

      case "codex":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "kiro":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "qoder":
        // Qoder ships a `user` quota and (optionally) an `organization`
        // quota, both with same shape: {total, used, remaining, unit, resetAt}.
        // Skip an organization bucket when its total is 0 — most personal
        // Qoder accounts won't have one and rendering "0/0" is misleading.
        // Don't forward Qoder's `remaining` field: it's an absolute credit
        // count, but getRemainingPercentage / QuotaTable interpret
        // `remaining` as a 0-100 percentage and would render 348 credits
        // as "348%". The percentage is computed from used/total instead.
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            if (quotaType === "organization" && (!quota || (Number(quota.total) || 0) === 0)) {
              return;
            }
            normalizedQuotas.push({
              name: quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              unit: quota.unit,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          // Handle error message case
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message,
          });
        } else if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
        break;

      case "vercel-ai-gateway":
        // Vercel returns currency credit balance, not request quotas.
        // The 'Remaining (USD)' row needs explicit remainingPercentage because
        // its used/total values would otherwise compute the wrong direction
        // (e.g. used=95.5 / total=100 → 4% instead of 96%).
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          });
        }
        break;

      default:
        // Generic fallback for unknown providers
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          });
        }
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  // Sort quotas according to PROVIDER_MODELS order
  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m, i) => [m.id, i]));

    normalizedQuotas.sort((a, b) => {
      // Use modelKey for antigravity, otherwise use name
      const keyA = a.modelKey || a.name;
      const keyB = b.modelKey || b.name;
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}
