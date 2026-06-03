/**
 * Manual quota tracking — dành cho các provider không có quota API.
 *
 * Cơ chế:
 * - Fixed window (không phải rolling) — đúng theo cách AliCode tính
 * - Đếm request từ usageDaily (byAccount → connectionId)
 * - So sánh với thresholds để auto-detect plan (Lite vs Pro)
 * - Trả về quota object tương thích với ProviderLimits UI
 *
 * ⚠️ Lưu ý: Local counter đếm TẤT CẢ request qua 9Router.
 * AliCode có thể đếm khác (theo API call thực tế, filter theo model...).
 * Số liệu local chỉ mang tính tham khảo, gần đúng.
 */

import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

// ─── AliCode quota plan definitions ─────────────────────────────────────────
export const ALICODE_PLANS = {
  lite: {
    name: "Lite",
    windows: [
      { name: "5h requests", limit: 1200 },
      { name: "Weekly requests", limit: 9000 },
      { name: "Monthly requests", limit: 18000 },
    ],
  },
  pro: {
    name: "Pro",
    windows: [
      { name: "5h requests", limit: 6000 },
      { name: "Weekly requests", limit: 45000 },
      { name: "Monthly requests", limit: 90000 },
    ],
  },
};

/**
 * Detect plan từ connection data (lưu trong providerSpecificData.manualQuotaPlan).
 * Nếu chưa set → auto-detect từ monthly count.
 */
export function detectAlicodePlan(totalMonthlyRequests, storedPlan) {
  if (storedPlan && (storedPlan === "lite" || storedPlan === "pro")) return storedPlan;
  return totalMonthlyRequests >= 18000 ? "pro" : "lite";
}

/**
 * Tính window start/end dạng fixed theo AliCode.
 * - 5h: fixed 5h blocks từ UTC 00:00 (0-5, 5-10, 10-15, 15-20, 20-24)
 * - Weekly: reset Sunday 23:00 UTC+7 (= 16:00 UTC)
 * - Monthly: reset ngày 4 hàng tháng 23:00 UTC+7 (= 16:00 UTC)
 */
function computeFixedWindow(windowKey, now) {
  const d = new Date(now);

  if (windowKey === "5h") {
    // Fixed 5h blocks: 00-05, 05-10, 10-15, 15-20, 20-24 UTC
    const utcHour = d.getUTCHours();
    const blockStart = Math.floor(utcHour / 5) * 5;
    const start = new Date(d);
    start.setUTCHours(blockStart, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(blockStart + 5, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (windowKey === "weekly") {
    // Reset Sunday 16:00 UTC (= 23:00 UTC+7)
    const dayOfWeek = d.getUTCDay(); // 0=Sun
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - dayOfWeek);
    start.setUTCHours(16, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (windowKey === "monthly") {
    // Reset ngày mùng 4, 16:00 UTC (= 23:00 UTC+7)
    const day = d.getUTCDate();
    const start = new Date(d);
    if (day >= 4) {
      start.setUTCDate(4);
    } else {
      start.setUTCMonth(d.getUTCMonth() - 1);
      start.setUTCDate(4);
    }
    start.setUTCHours(16, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(start.getUTCMonth() + 1);
    end.setUTCDate(4);
    end.setUTCHours(16, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  return { start: null, end: null };
}

function formatCountdown(isoString) {
  if (!isoString) return "-";
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "now";

  const totalMins = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainH = hours % 24;
    return remainH > 0 ? `${days}d ${remainH}h` : `${days}d`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Đếm số request của connection trong khoảng [startDate, endDate].
 * Đọc từ usageDaily table → aggregate byAccount theo connectionId.
 * Partial day ở đầu/cuối: đếm trực tiếp từ usageHistory để chính xác.
 */
async function countRequestsInRange(connectionId, startDate, endDate) {
  const db = await getAdapter();
  const startKey = startDate.toISOString().slice(0, 10);
  const endKey = endDate.toISOString().slice(0, 10);

  // Lấy daily records trong range
  const rows = db.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? AND dateKey <= ?`,
    [startKey, endKey]
  );

  let total = 0;
  const startTs = startDate.getTime();
  const endTs = endDate.getTime();

  for (const row of rows) {
    const dayData = parseJson(row.data, {});
    const accountData = dayData.byAccount?.[connectionId];
    if (!accountData) continue;

    // Nếu ngày này nằm hoàn toàn trong range → lấy total
    const dayStart = new Date(row.dateKey + "T00:00:00Z").getTime();
    const dayEnd = dayStart + 86400000;

    if (dayStart >= startTs && dayEnd <= endTs) {
      total += accountData.requests || 0;
    } else {
      // Partial day → đếm từ usageHistory để chính xác
      const histRows = db.all(
        `SELECT COUNT(*) as cnt FROM usageHistory
         WHERE connectionId = ? AND timestamp >= ? AND timestamp < ?`,
        [connectionId, startDate.toISOString(), endDate.toISOString()]
      );
      total += histRows[0]?.cnt || 0;
    }
  }

  return total;
}

/**
 * Đếm total 30 ngày qua để detect plan (dùng làm fallback).
 */
async function countRequestsLast30Days(connectionId) {
  const db = await getAdapter();
  const now = Date.now();
  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  const rows = db.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`,
    [cutoff]
  );

  let total = 0;
  for (const row of rows) {
    const dayData = parseJson(row.data, {});
    const accountData = dayData.byAccount?.[connectionId];
    if (accountData) total += accountData.requests || 0;
  }
  return total;
}

/**
 * Hàm chính: trả về quota data cho alicode connection.
 * Fixed window, đúng theo cách AliCode tính.
 */
export async function getAlicodeManualQuota(connectionId, connection) {
  try {
    const now = new Date();

    // Lấy stored plan từ connection data nếu có
    const storedPlan = connection?.providerSpecificData?.manualQuotaPlan;
    const monthlyTotalForDetect = await countRequestsLast30Days(connectionId);
    const plan = detectAlicodePlan(monthlyTotalForDetect, storedPlan);
    const planDef = ALICODE_PLANS[plan];

    // Tính từng fixed window
    const windowKeys = ["5h", "weekly", "monthly"];
    const quotas = [];

    for (let i = 0; i < planDef.windows.length; i++) {
      const win = planDef.windows[i];
      const wKey = windowKeys[i];
      const { start, end } = computeFixedWindow(wKey, now);

      let used = 0;
      if (start && end) {
        used = await countRequestsInRange(connectionId, new Date(start), new Date(end));
      }

      // 5h và weekly là counting real-time đến hiện tại → ẩn reset info
      const isRollingWindow = wKey === "5h" || wKey === "weekly";

      quotas.push({
        name: win.name,
        used,
        total: win.limit,
        remainingPercentage: Math.max(0, Math.round(((win.limit - used) / win.limit) * 100)),
        resetAt: isRollingWindow ? null : end,
        resetCountdown: isRollingWindow ? null : formatCountdown(end),
        hideReset: isRollingWindow || false,
        windowStart: start,
        windowEnd: end,
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
        monthlyTotalRequests: monthlyTotalForDetect,
        source: "manual-counter",
        note: "Local counter — counts all requests through 9Router. May differ from AliCode's actual quota.",
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

export async function getManualQuota(provider, connectionId, connection) {
  const handler = MANUAL_QUOTA_HANDLERS[provider];
  if (!handler) return null;
  return handler(connectionId, connection);
}
