/**
 * Manual quota tracking — dành cho các provider không có quota API.
 * 
 * Cơ chế:
 * - Đếm số request thực tế từ usageDaily (byAccount → connectionId)
 * - So sánh với thresholds để tự động detect plan (Lite vs Pro)
 * - Trả về quota object tương thích với ProviderLimits UI
 */

import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";

// ─── AliCode quota plan definitions ─────────────────────────────────────────
export const ALICODE_PLANS = {
  lite: {
    name: "Lite",
    windows: [
      { name: "5h requests",   limit: 1200,  windowMs: 5 * 60 * 60 * 1000 },
      { name: "Weekly requests", limit: 9000,  windowMs: 7 * 24 * 60 * 60 * 1000 },
      { name: "Monthly requests", limit: 18000, windowMs: 30 * 24 * 60 * 60 * 1000 },
    ],
  },
  pro: {
    name: "Pro",
    windows: [
      { name: "5h requests",   limit: 6000,  windowMs: 5 * 60 * 60 * 1000 },
      { name: "Weekly requests", limit: 45000, windowMs: 7 * 24 * 60 * 60 * 1000 },
      { name: "Monthly requests", limit: 90000, windowMs: 30 * 24 * 60 * 60 * 1000 },
    ],
  },
};

/**
 * Tự động detect plan dựa trên số request trong window dài nhất (monthly).
 * Logic: nếu request trong tháng vượt ngưỡng Lite (18k) → Pro, ngược lại Lite.
 * Nếu chưa đủ dữ liệu → trả về Lite (conservative).
 */
export function detectAlicodePlan(totalMonthlyRequests) {
  if (!totalMonthlyRequests || totalMonthlyRequests < 18000) return "lite";
  return "pro";
}

/**
 * Tính reset time cho từng window.
 * Rolling window: reset tại thời điểm oldest request + windowMs.
 * Nếu không có request nào → reset tại now + windowMs.
 */
function computeResetAt(windowMs, now, oldestRequestTimestamp) {
  if (oldestRequestTimestamp) {
    // Rolling từ lần request cũ nhất trong window
    return new Date(oldestRequestTimestamp + windowMs).toISOString();
  }
  // Chưa có request → reset tại now + windowMs
  return new Date(now + windowMs).toISOString();
}

function formatCountdown(isoString) {
  if (!isoString) return "-";
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "0m";

  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

/**
 * Đếm số request của một connection trong khoảng thời gian.
 * Đọc từ usageDaily table, aggregate byAccount theo connectionId.
 */
async function countRequestsInWindow(connectionId, windowMs) {
  const db = await getAdapter();
  const now = Date.now();
  const cutoff = now - windowMs;

  // Lấy tất cả daily records trong window
  const rows = db.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`,
    [new Date(cutoff).toISOString().slice(0, 10)]
  );

  let total = 0;
  for (const row of rows) {
    const dayData = parseJson(row.data, {});
    if (dayData.byAccount && dayData.byAccount[connectionId]) {
      total += dayData.byAccount[connectionId].requests || 0;
    }
  }

  return total;
}

/**
 * Hàm chính: trả về quota data cho alicode connection.
 * Format tương thích với ProviderLimits UI.
 */
export async function getAlicodeManualQuota(connectionId) {
  try {
    const now = Date.now();

    // Đếm request trong monthly window để detect plan
    const monthlyCount = await countRequestsInWindow(connectionId, 30 * 24 * 60 * 60 * 1000);
    const plan = detectAlicodePlan(monthlyCount);
    const planDef = ALICODE_PLANS[plan];

    // Đếm từng window
    const quotas = [];
    for (const win of planDef.windows) {
      const used = await countRequestsInWindow(connectionId, win.windowMs);
      const resetAt = computeResetAt(win.windowMs, now);

      quotas.push({
        name: win.name,
        used,
        total: win.limit,
        remainingPercentage: Math.max(0, Math.round(((win.limit - used) / win.limit) * 100)),
        resetAt,
        resetCountdown: formatCountdown(resetAt),
      });
    }

    return {
      plan: planDef.name,
      quotas,
      message: null,
      raw: {
        provider: "alicode",
        connectionId,
        plan,
        monthlyTotalRequests: monthlyCount,
        source: "manual-counter",
      },
    };
  } catch (e) {
    console.error("[ManualQuota] getAlicodeManualQuota error:", e.message);
    return {
      plan: null,
      quotas: [],
      message: `Manual counter error: ${e.message}`,
      raw: { source: "manual-counter-error" },
    };
  }
}

// ─── Registry: provider → manual quota function ─────────────────────────────
const MANUAL_QUOTA_HANDLERS = {
  alicode: getAlicodeManualQuota,
  "alicode-intl": getAlicodeManualQuota,
};

export function hasManualQuota(provider) {
  return provider in MANUAL_QUOTA_HANDLERS;
}

export async function getManualQuota(provider, connectionId) {
  const handler = MANUAL_QUOTA_HANDLERS[provider];
  if (!handler) return null;
  return handler(connectionId);
}
