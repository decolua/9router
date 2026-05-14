import { getAdapter } from "../driver.js";

export async function checkQuota(apiKey) {
  const db = await getAdapter();

  const row = db.get(`SELECT quotaType, quotaLimit, quotaResetHours, creditBalance FROM apiKeys WHERE key = ?`, [apiKey]);
  if (!row || !row.quotaType || row.quotaType === "none") {
    return { allowed: true, remaining: Infinity, resetsAt: null, quotaType: "none" };
  }

  if (row.quotaType === "hourly") {
    if (row.quotaLimit == null) {
      const periodMs = (row.quotaResetHours || 1) * 3600000;
      const now = Date.now();
      const resetsAt = new Date(Math.floor(now / periodMs) * periodMs + periodMs).toISOString();
      return { allowed: true, remaining: Infinity, resetsAt, quotaType: "hourly" };
    }
    const periodMs = (row.quotaResetHours || 1) * 3600000;
    const now = Date.now();
    const periodStart = new Date(Math.floor(now / periodMs) * periodMs).toISOString();

    const result = db.get(
      `SELECT COALESCE(SUM(cost), 0) as totalCost FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
      [apiKey, periodStart]
    );
    const used = result?.totalCost || 0;
    const limit = row.quotaLimit;
    const remaining = Math.max(0, limit - used);
    const resetsAt = new Date(Math.floor(now / periodMs) * periodMs + periodMs).toISOString();

    return {
      allowed: used < limit,
      remaining,
      resetsAt,
      quotaType: "hourly",
    };
  }

  if (row.quotaType === "credit") {
    if (row.creditBalance == null) {
      return { allowed: true, remaining: Infinity, resetsAt: null, quotaType: "credit" };
    }
    const result = db.get(
      `SELECT COALESCE(SUM(cost), 0) as totalCost FROM usageHistory WHERE apiKey = ?`,
      [apiKey]
    );
    const used = result?.totalCost || 0;
    const limit = row.creditBalance;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used < limit,
      remaining,
      resetsAt: null,
      quotaType: "credit",
    };
  }

  return { allowed: true, remaining: Infinity, resetsAt: null, quotaType: "none" };
}
