/**
 * Cursor IDE usage — DashboardService Connect JSON on api2.cursor.sh.
 *
 * Pro / Team / Ultra: POST GetCurrentPeriodUsage (spend in USD cents).
 * Enterprise request buckets: GET /auth/usage as fallback.
 * Plan label: POST GetPlanInfo (fail-open).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import { buildCursorHeaders } from "../../utils/cursorChecksum.js";

const CURSOR_USAGE = U("cursor");

function centsToUsd(cents) {
  return Number((toFiniteNumber(cents, 0) / 100).toFixed(2));
}

function remainingFromPercentUsed(percentUsed) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(percentUsed, 0)));
  return Math.max(0, 100 - used);
}

function connectJsonHeaders(accessToken, machineId) {
  return {
    ...buildCursorHeaders(accessToken, machineId || null, true),
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function postConnectJson(url, accessToken, machineId, proxyOptions) {
  return proxyAwareFetch(
    url,
    {
      method: "POST",
      headers: connectJsonHeaders(accessToken, machineId),
      body: "{}",
    },
    proxyOptions,
  );
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function addPlanSpendQuotas(quotas, data) {
  const planUsage = data?.planUsage;
  if (!planUsage || typeof planUsage !== "object") return false;

  const limitCents = toFiniteNumber(planUsage.limit, 0);
  const usedCents = toFiniteNumber(
    planUsage.includedSpend ?? planUsage.totalSpend,
    0,
  );
  const remainingCents = toFiniteNumber(
    planUsage.remaining,
    Math.max(0, limitCents - usedCents),
  );
  const resetAt = parseResetTime(data.billingCycleEnd);

  if (limitCents > 0) {
    const total = centsToUsd(limitCents);
    const used = centsToUsd(usedCents);
    const remainingUsd = centsToUsd(remainingCents);
    quotas["Plan (USD)"] = {
      used,
      total,
      remainingPercentage:
        planUsage.totalPercentUsed != null
          ? remainingFromPercentUsed(planUsage.totalPercentUsed)
          : total > 0
            ? (remainingUsd / total) * 100
            : 0,
      resetAt,
    };
  } else if (planUsage.totalPercentUsed != null) {
    const used = toFiniteNumber(planUsage.totalPercentUsed, 0);
    quotas["Included usage"] = {
      used,
      total: 100,
      remainingPercentage: remainingFromPercentUsed(used),
      resetAt,
    };
  }

  if (planUsage.autoPercentUsed != null) {
    const used = toFiniteNumber(planUsage.autoPercentUsed, 0);
    quotas["Auto models (%)"] = {
      used,
      total: 100,
      remainingPercentage: remainingFromPercentUsed(used),
      resetAt,
    };
  }
  if (planUsage.apiPercentUsed != null) {
    const used = toFiniteNumber(planUsage.apiPercentUsed, 0);
    quotas["Named models (%)"] = {
      used,
      total: 100,
      remainingPercentage: remainingFromPercentUsed(used),
      resetAt,
    };
  }

  return Object.keys(quotas).length > 0;
}

function addOnDemandQuota(quotas, data) {
  const spend = data?.spendLimitUsage;
  if (!spend || typeof spend !== "object") return;

  const individualLimit = toFiniteNumber(spend.individualLimit, 0);
  const pooledLimit = toFiniteNumber(spend.pooledLimit, 0);
  const resetAt = parseResetTime(data.billingCycleEnd);

  if (individualLimit > 0) {
    const used = centsToUsd(spend.individualUsed);
    const total = centsToUsd(individualLimit);
    const remainingUsd = centsToUsd(
      spend.individualRemaining ?? Math.max(0, individualLimit - toFiniteNumber(spend.individualUsed, 0)),
    );
    quotas["On-demand (USD)"] = {
      used,
      total,
      remainingPercentage: total > 0 ? (remainingUsd / total) * 100 : 0,
      resetAt,
    };
    return;
  }

  if (pooledLimit > 0) {
    const used = centsToUsd(spend.pooledUsed);
    const total = centsToUsd(pooledLimit);
    const remainingUsd = centsToUsd(
      spend.pooledRemaining ?? Math.max(0, pooledLimit - toFiniteNumber(spend.pooledUsed, 0)),
    );
    quotas["Team on-demand (USD)"] = {
      used,
      total,
      remainingPercentage: total > 0 ? (remainingUsd / total) * 100 : 0,
      resetAt,
    };
  }
}

function addAuthUsageQuotas(quotas, data) {
  if (!data || typeof data !== "object") return false;
  const resetAt = parseResetTime(data.startOfMonth);
  let added = false;

  for (const [key, bucket] of Object.entries(data)) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    const total = toFiniteNumber(bucket.maxRequestUsage, 0);
    if (total <= 0) continue;
    const used = toFiniteNumber(bucket.numRequests, 0);
    quotas[`${key} requests`] = {
      used,
      total,
      remainingPercentage: total > 0 ? Math.max(0, ((total - used) / total) * 100) : 0,
      resetAt,
    };
    added = true;
  }

  return added;
}

export async function getCursorUsage(accessToken, providerSpecificData = {}, proxyOptions = null) {
  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    return { message: "Cursor access token not available. Reconnect Cursor to view quota." };
  }

  const token = accessToken.trim();
  const machineId = providerSpecificData?.machineId || null;
  const periodUrl = CURSOR_USAGE.url;
  const planInfoUrl = CURSOR_USAGE.planInfoUrl;
  const authUsageUrl = CURSOR_USAGE.authUsageUrl;

  if (!periodUrl) {
    return { message: "Cursor usage endpoint is not configured." };
  }

  try {
    const periodResponse = await postConnectJson(periodUrl, token, machineId, proxyOptions);

    if (periodResponse.status === 401 || periodResponse.status === 403) {
      return {
        plan: "Cursor",
        message: "Cursor authentication failed. Reconnect the Cursor provider.",
      };
    }

    const quotas = {};
    let periodData = null;

    if (periodResponse.ok) {
      periodData = await readJson(periodResponse);
      addPlanSpendQuotas(quotas, periodData);
      addOnDemandQuota(quotas, periodData);
    }

    if (Object.keys(quotas).length === 0 && authUsageUrl) {
      const authResponse = await proxyAwareFetch(
        authUsageUrl,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token.includes("::") ? token.split("::")[1] : token}`,
            Accept: "application/json",
          },
        },
        proxyOptions,
      );
      if (authResponse.ok) {
        addAuthUsageQuotas(quotas, await readJson(authResponse));
      } else if (!periodResponse.ok) {
        const errText = await periodResponse.text().catch(() => "");
        return {
          plan: "Cursor",
          message: `Cursor usage API error (${periodResponse.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
        };
      }
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan: "Cursor",
        message: periodData?.displayMessage || "Cursor connected. No quota data returned for this plan.",
      };
    }

    let plan = "Cursor";
    if (planInfoUrl) {
      const planResponse = await postConnectJson(planInfoUrl, token, machineId, proxyOptions).catch(() => null);
      if (planResponse?.ok) {
        const planData = await readJson(planResponse);
        const planName = planData?.planInfo?.planName;
        if (typeof planName === "string" && planName.trim()) {
          plan = `Cursor ${planName.trim()}`;
        }
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Cursor error: ${error.message}` };
  }
}
