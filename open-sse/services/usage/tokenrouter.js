/**
 * TokenRouter usage — Management API (read-only)
 *
 * A single account-level Management Key (separate from the inference key) is
 * used to inspect every API key on the account via the Management API:
 *   GET /api/management/api-keys      → per-key quota snapshot
 *   GET /api/management/self/wallet   → account wallet balance
 *
 * Docs: https://api.tokenrouter.com/api/management
 * Auth: Authorization: Bearer <Management Key>
 *
 * The management key is optional. When missing or invalid we return a
 * `message` (instead of throwing) so the quota tracker can prompt the user
 * to add a management key on the connection.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

const MANAGEMENT_BASE_URL = U("tokenrouter").url || "https://api.tokenrouter.com/api/management";

function parseExpiry(expiredTime) {
  // -1 → never expires; otherwise a UTC Unix (seconds) timestamp.
  if (expiredTime === undefined || expiredTime === null || Number(expiredTime) === -1) return null;
  const seconds = Number(expiredTime);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return num > 0 ? `$${num.toFixed(2)}` : "$0.00";
}

/**
 * Get TokenRouter usage for a management key.
 * @param {Object} providerSpecificData - Connection credentials (managementKey).
 * @param {Object|null} proxyOptions - Optional proxy config.
 * @returns {Object} { quotas, plan, message }
 */
export async function getTokenRouterUsage(providerSpecificData = {}, proxyOptions = null) {
  const managementKey = providerSpecificData?.managementKey?.trim();

  if (!managementKey) {
    return {
      message:
        "Add a TokenRouter Management Key to track quotas. Find it on the TokenRouter dashboard (Settings → Management Key).",
      quotas: {},
    };
  }

  const headers = {
    Authorization: `Bearer ${managementKey}`,
    Accept: "application/json",
  };

  try {
    // ── 1. Account wallet (best-effort; 404/empty is fine for personal accounts) ──
    let wallet = {};
    try {
      const walletRes = await proxyAwareFetch(`${MANAGEMENT_BASE_URL}/self/wallet`, { headers }, proxyOptions);
      if (walletRes.ok) {
        const walletJson = await walletRes.json();
        wallet = walletJson?.data && typeof walletJson.data === "object" ? walletJson.data : {};
      }
    } catch {
      // Wallet is optional — never fail the whole quota fetch on it.
    }

    // ── 2. API keys + per-key quota ──
    const keysRes = await proxyAwareFetch(`${MANAGEMENT_BASE_URL}/api-keys?page=1&page_size=100`, { headers }, proxyOptions);

    if (keysRes.status === 401 || keysRes.status === 403) {
      return {
        message: "TokenRouter Management Key invalid or expired. Re-check the key on the connection.",
        quotas: {},
      };
    }

    if (!keysRes.ok) {
      return { message: `TokenRouter Management API error (${keysRes.status}).` };
    }

    const keysJson = await keysRes.json();
    const items = Array.isArray(keysJson?.data?.items) ? keysJson.data.items : [];

    const quotas = {};

    // Account wallet row (if any balance exists)
    const topUp = Number(wallet.topUpBalance) || 0;
    const voucher = Number(wallet.voucherEfficientAmount) || 0;
    const totalBalance = topUp + voucher;
    if (totalBalance > 0) {
      quotas["Account Balance"] = {
        used: 0,
        total: totalBalance,
        remaining: totalBalance,
        remainingPercentage: 100,
        unlimited: false,
        wallet: true,
        meta: {
          topUpBalance: formatMoney(topUp),
          voucherEfficientAmount: formatMoney(voucher),
        },
      };
    }

    // One quota row per API key
    for (const key of items) {
      const unlimited = Boolean(key.unlimited_quota);
      const used = Number(key.used_quota) || 0;
      const remaining = Number(key.remain_quota) || 0;
      const name = key.name || "Unnamed key";

      quotas[`Key: ${name}`] = {
        used,
        total: unlimited ? 0 : remaining + used,
        remaining: unlimited ? null : Math.max(0, remaining),
        remainingPercentage: unlimited ? 100 : undefined,
        unlimited,
        status: Number(key.status) === 1 ? "enabled" : "disabled",
        expiresAt: parseExpiry(key.expired_time),
        keyName: name,
      };
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan: "TokenRouter",
        message: "No API keys or wallet balance found for this Management Key.",
        quotas: {},
      };
    }

    return { plan: "TokenRouter", quotas };
  } catch (error) {
    return { message: `TokenRouter usage error: ${error.message}` };
  }
}