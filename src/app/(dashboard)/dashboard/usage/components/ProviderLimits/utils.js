import { getModelsByProviderId } from "open-sse/config/providerModels.js";

/**
 * Format ISO date string to countdown format (inspired by vscode-antigravity-cockpit)
 * @param {string|Date} date - ISO date string or Date object
 * @returns {string} Formatted countdown (e.g., "2d 5h 30m", "4h 40m", "15m") or "-"
 */
export function formatResetTime(date) {
  if (!date) return "-";

  try {
    const resetDate = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const diffMs = resetDate - now;

    if (diffMs <= 0) return "-";

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));
    
    // < 60 minutes: show only minutes
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    
    // < 24 hours: show hours and minutes
    if (totalHours < 24) {
      return `${totalHours}h ${remainingMinutes}m`;
    }
    
    // >= 24 hours: show days, hours, and minutes
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  } catch (error) {
    return "-";
  }
}

/**
 * Get Tailwind color class based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Color name: "green" | "yellow" | "red"
 */
export function getStatusColor(percentage) {
  if (percentage > 70) return "green";
  if (percentage >= 30) return "yellow";
  return "red"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Get status emoji based on percentage
 * @param {number} percentage - Remaining percentage (0-100)
 * @returns {string} Emoji: "🟢" | "🟡" | "🔴"
 */
export function getStatusEmoji(percentage) {
  if (percentage > 70) return "🟢";
  if (percentage >= 30) return "🟡";
  return "🔴"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Calculate remaining percentage
 * @param {number} used - Used amount
 * @param {number} total - Total amount
 * @returns {number} Remaining percentage (0-100)
 */
export function calculatePercentage(used, total) {
  if (!total || total === 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;

  return Math.round(((total - used) / total) * 100);
}

/**
 * Parse provider-specific quota structures into normalized array
 * @param {string} provider - Provider name (github, antigravity, codex, kiro, claude)
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
            if (!quota || typeof quota !== "object") return;

            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remaining: quota.remaining,
            });
          });
        }
        break;

      case "kiro":
        if (data.quotas) {
          Object.entries(data.quotas).forEach(([quotaType, quota]) => {
            const hasValidRemainingPercentage = Number.isFinite(quota.remainingPercentage)
              && quota.remainingPercentage >= 0
              && quota.remainingPercentage <= 100;

            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              ...(hasValidRemainingPercentage ? { remainingPercentage: quota.remainingPercentage } : {}),
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

export function parseStoredUsageSnapshot(connection = {}) {
  const snapshot = connection?.usageSnapshot;
  if (!snapshot) return null;

  if (typeof snapshot === "object") {
    return snapshot;
  }

  if (typeof snapshot !== "string") {
    return null;
  }

  try {
    return JSON.parse(snapshot);
  } catch (error) {
    console.warn(`Failed to parse usage snapshot for ${connection?.provider || "provider"}/${connection?.id || "unknown"}:`, error);
    return null;
  }
}

export function getStoredQuotaPresentation(connection = {}) {
  const raw = parseStoredUsageSnapshot(connection);

  if (!raw) {
    return {
      quotas: [],
      plan: null,
      message: null,
      raw: null,
      hasSnapshot: false,
    };
  }

  return {
    quotas: parseQuotaData(connection.provider, raw),
    plan: raw.plan || null,
    message: raw.message || null,
    raw,
    hasSnapshot: true,
  };
}
