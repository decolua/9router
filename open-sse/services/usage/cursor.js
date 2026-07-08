/**
 * Cursor usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { buildCursorHeaders } from "../../utils/cursorChecksum.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const CURSOR_USAGE_CONFIG = {
  currentPeriodUsageUrl: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
  planInfoUrl: "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
  authUsageUrl: "https://api2.cursor.sh/auth/usage",
};

function buildCursorUsageHeaders(accessToken, providerSpecificData = {}) {
  const machineId = providerSpecificData?.machineId || null;
  const headers = buildCursorHeaders(accessToken, machineId);
  return {
    ...headers,
    "content-type": "application/json",
    accept: "application/json",
  };
}

function formatCursorPercentWindow(percentUsed, resetAt) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(percentUsed, 0)));
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt,
    unlimited: false,
  };
}

function formatCursorCentsWindow(spentCents, limitCents, resetAt) {
  const usedCents = toFiniteNumber(spentCents, 0);
  const totalCents = toFiniteNumber(limitCents, 0);
  if (totalCents <= 0) return null;

  const usedDollars = usedCents / 100;
  const totalDollars = totalCents / 100;
  const remainingDollars = Math.max(0, totalDollars - usedDollars);

  return {
    used: usedDollars,
    total: totalDollars,
    remaining: totalDollars > 0 ? Math.round((remainingDollars / totalDollars) * 100) : 0,
    resetAt,
    unlimited: false,
    unit: "usd",
  };
}

function parseCursorDashboardUsage(data) {
  const quotas = {};
  const resetAt = parseResetTime(data?.billingCycleEnd);
  const planUsage = data?.planUsage || {};

  const included = formatCursorCentsWindow(
    planUsage.includedSpend ?? planUsage.totalSpend,
    planUsage.limit,
    resetAt,
  );
  if (included) quotas["Included spend"] = included;

  if (Number.isFinite(Number(planUsage.autoPercentUsed))) {
    quotas["Auto mode"] = formatCursorPercentWindow(planUsage.autoPercentUsed, resetAt);
  }

  if (Number.isFinite(Number(planUsage.apiPercentUsed))) {
    quotas["API usage"] = formatCursorPercentWindow(planUsage.apiPercentUsed, resetAt);
  }

  const spendLimit = data?.spendLimitUsage || {};
  const individualLimit = toFiniteNumber(spendLimit.individualLimit, 0);
  if (individualLimit > 0) {
    const row = formatCursorCentsWindow(spendLimit.individualUsed, individualLimit, resetAt);
    if (row) quotas["On-demand (individual)"] = row;
  }

  const pooledLimit = toFiniteNumber(spendLimit.pooledLimit, 0);
  if (pooledLimit > 0) {
    const row = formatCursorCentsWindow(spendLimit.pooledUsed, pooledLimit, resetAt);
    if (row) quotas["On-demand (team pool)"] = row;
  }

  return quotas;
}

function parseCursorAuthUsage(data) {
  const quotas = {};
  if (!data || typeof data !== "object") return quotas;

  const resetAt = parseResetTime(data.startOfMonth);

  for (const [modelKey, bucket] of Object.entries(data)) {
    if (modelKey === "startOfMonth" || !bucket || typeof bucket !== "object") continue;

    const used = toFiniteNumber(bucket.numRequests, 0);
    const total = toFiniteNumber(bucket.maxRequestUsage, 0);
    if (total <= 0) continue;

    quotas[modelKey] = {
      used,
      total,
      remaining: Math.max(0, Math.round(((total - used) / total) * 100)),
      resetAt,
      unlimited: false,
    };
  }

  return quotas;
}

export async function getCursorUsage(accessToken, providerSpecificData = {}, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Cursor usage unavailable: no access token" };
  }

  const headers = buildCursorUsageHeaders(accessToken, providerSpecificData);

  try {
    const usageRes = await proxyAwareFetch(
      CURSOR_USAGE_CONFIG.currentPeriodUsageUrl,
      { method: "POST", headers, body: "{}" },
      proxyOptions,
    );

    if (usageRes.status === 401) {
      return { message: "Cursor token expired or invalid. Re-import from Cursor IDE." };
    }

    // Consume usage body before opening another request to api2.cursor.sh.
    // Reusing the keep-alive socket without draining the first body yields empty JSON.
    const usageText = usageRes.ok ? await usageRes.text().catch(() => "") : "";
    let usageData = null;
    if (usageText) {
      try {
        usageData = JSON.parse(usageText);
      } catch {
        usageData = null;
      }
    }

    let planName = null;
    try {
      const planRes = await proxyAwareFetch(
        CURSOR_USAGE_CONFIG.planInfoUrl,
        { method: "POST", headers, body: "{}" },
        proxyOptions,
      );
      if (planRes?.ok) {
        const planData = await planRes.json().catch(() => ({}));
        planName = planData?.planInfo?.planName || null;
      }
    } catch {
      // Plan info is optional; usage data is the primary signal.
    }

    if (usageRes.ok) {
      const data = usageData;
      const quotas = parseCursorDashboardUsage(data || {});
      if (Object.keys(quotas).length > 0) {
        return {
          plan: planName,
          billingCycleStart: parseResetTime(data?.billingCycleStart),
          billingCycleEnd: parseResetTime(data?.billingCycleEnd),
          displayMessage: data?.displayMessage || null,
          quotas,
        };
      }
    }

    const fallbackRes = await proxyAwareFetch(
      CURSOR_USAGE_CONFIG.authUsageUrl,
      {
        method: "GET",
        headers: {
          authorization: headers.authorization,
          accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (fallbackRes.status === 401) {
      return { message: "Cursor token expired or invalid. Re-import from Cursor IDE." };
    }

    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json().catch(() => null);
      const quotas = parseCursorAuthUsage(fallbackData || {});
      if (Object.keys(quotas).length > 0) {
        return { plan: planName, quotas };
      }
    }

    return {
      message: `Cursor connected. Usage API temporarily unavailable (${usageRes.status}).`,
    };
  } catch (error) {
    throw new Error(`Failed to fetch Cursor usage: ${error.message}`);
  }
}