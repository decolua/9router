/**
 * DeepSeek usage — GET https://api.deepseek.com/user/balance
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const BALANCE_URL = "https://api.deepseek.com/user/balance";

function parseBalanceInfos(data) {
  const list = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  const results = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const currency =
      typeof item.currency === "string" ? item.currency.toUpperCase() : "";
    if (!currency) continue;
    const totalBalance = toFiniteNumber(
      item.total_balance ?? item.totalBalance,
      0,
    );
    results.push({
      currency,
      totalBalance,
      grantedBalance: toFiniteNumber(
        item.granted_balance ?? item.grantedBalance,
        0,
      ),
      toppedUpBalance: toFiniteNumber(
        item.topped_up_balance ?? item.toppedUpBalance,
        0,
      ),
    });
  }
  return results;
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getDeepseekUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "DeepSeek API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      BALANCE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return {
        plan: "DeepSeek",
        message: "DeepSeek authentication failed. Check the API key.",
      };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: "DeepSeek",
        message: `DeepSeek balance API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { message: "DeepSeek balance response was not JSON." };
    }

    const balances = parseBalanceInfos(data);
    if (balances.length === 0) {
      return {
        plan: "DeepSeek",
        message: "DeepSeek connected. No balance data returned.",
      };
    }

    const isAvailable = data.is_available === true || data.isAvailable === true;
    const quotas = {};
    for (const b of balances) {
      const total = Math.max(0, b.totalBalance);
      // Credit pot: show full remaining against current balance; never set absolute
      // `remaining` — QuotaTable treats it as a 0–100 percentage.
      quotas[`Balance (${b.currency})`] = {
        used: 0,
        total,
        remainingPercentage: total > 0 ? 100 : 0,
        resetAt: null,
        unlimited: total > 0,
      };
    }

    return {
      plan: isAvailable ? "DeepSeek" : "DeepSeek (Insufficient Balance)",
      quotas,
    };
  } catch (error) {
    return { message: `DeepSeek error: ${error.message}` };
  }
}
