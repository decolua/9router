import { getAdapter } from "../driver.js";

/**
 * Get lifetime usage totals for a single API key.
 * @param {string} apiKeyId
 * @returns {Promise<{ totalTokens: number, totalCost: number, totalRequests: number, updatedAt: string } | null>}
 */
export async function getApiKeyUsageTotals(apiKeyId) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [apiKeyId]);
  if (!row) return { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null };
  return {
    apiKeyId: row.apiKeyId,
    totalTokens: row.totalTokens || 0,
    totalCost: row.totalCost || 0,
    totalRequests: row.totalRequests || 0,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get lifetime usage totals for all API keys.
 * @returns {Promise<Record<string, { totalTokens: number, totalCost: number, totalRequests: number }>>}
 */
export async function getAllApiKeyUsageTotals() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeyUsageTotals`);
  const map = {};
  for (const row of rows) {
    map[row.apiKeyId] = {
      totalTokens: row.totalTokens || 0,
      totalCost: row.totalCost || 0,
      totalRequests: row.totalRequests || 0,
    };
  }
  return map;
}

/**
 * Increment usage totals for an API key. Called inside the saveRequestUsage transaction.
 * Must be called with a db adapter already obtained (sync context).
 *
 * @param {object} db - adapter instance (from getAdapter())
 * @param {string} apiKeyId
 * @param {{ tokens: number, cost: number }} usage
 */
export function incrementApiKeyUsageSync(db, apiKeyId, { tokens, cost }) {
  if (!apiKeyId) return;
  const now = new Date().toISOString();
  const row = db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [apiKeyId]);
  if (row) {
    db.run(
      `UPDATE apiKeyUsageTotals SET totalTokens = ?, totalCost = ?, totalRequests = ?, updatedAt = ? WHERE apiKeyId = ?`,
      [
        (row.totalTokens || 0) + (tokens || 0),
        (row.totalCost || 0) + (cost || 0),
        (row.totalRequests || 0) + 1,
        now,
        apiKeyId,
      ]
    );
  } else {
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [apiKeyId, tokens || 0, cost || 0, 1, now]
    );
  }
}
