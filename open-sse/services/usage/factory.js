import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";
import { resolveFactoryApiBase } from "../../executors/factory.js";

function formatFactoryWindow(window) {
  if (!window || typeof window !== "object") return null;
  const used = Math.max(0, Math.min(100, toFiniteNumber(window.usedPercent ?? window.used_percent, 0)));
  const resetAt = parseResetTime(
    window.windowEnd ||
    window.window_end ||
    (typeof window.secondsRemaining === "number" ? Date.now() + window.secondsRemaining * 1000 : null)
  );
  return {
    used,
    total: 100,
    remaining: Math.max(0, 100 - used),
    resetAt,
    unlimited: false,
  };
}

export async function getFactoryUsage(accessToken, providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) {
    return { error: "Missing access token" };
  }

  const base = resolveFactoryApiBase({ providerSpecificData });
  const url = `${base}/api/billing/limits`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-Factory-Client": process.env.FACTORY_UPSTREAM_CLIENT_TYPE?.trim() || "cli",
    "X-Client-Version": "0.213.0",
    "User-Agent": "factory-cli/0.213.0",
  };

  const orgId = providerSpecificData?.orgId || process.env.FACTORY_ORG_ID?.trim();
  if (orgId) {
    headers["X-Factory-Org-Id"] = orgId;
  }

  try {
    const res = await proxyAwareFetch(url, { headers, signal: AbortSignal.timeout(10000) }, proxyOptions);
    if (!res.ok) {
      return { error: `Factory billing API error: HTTP ${res.status}` };
    }

    const data = await res.json();
    const limits = data.limits || {};
    const standard = limits.standard || {};
    const core = limits.core || {};

    const quotas = {};

    // Standard tier windows
    if (standard.fiveHour) quotas.standard_5h = formatFactoryWindow(standard.fiveHour);
    if (standard.weekly) quotas.standard_weekly = formatFactoryWindow(standard.weekly);
    if (standard.monthly) quotas.standard_monthly = formatFactoryWindow(standard.monthly);

    // Core tier windows
    if (core.fiveHour) quotas.core_5h = formatFactoryWindow(core.fiveHour);
    if (core.weekly) quotas.core_weekly = formatFactoryWindow(core.weekly);
    if (core.monthly) quotas.core_monthly = formatFactoryWindow(core.monthly);

    // Provide default session and weekly quotas for standard UI display
    if (quotas.standard_5h && !quotas.session) quotas.session = quotas.standard_5h;
    if (quotas.standard_weekly && !quotas.weekly) quotas.weekly = quotas.standard_weekly;

    const extraUsage = typeof data.extraUsageBalanceCents === "number"
      ? {
          balance: data.extraUsageBalanceCents / 100,
          allowed: data.extraUsageAllowed ?? false,
          overagePreference: data.overagePreference,
        }
      : null;

    return {
      quotas,
      plan: data.planType || "standard",
      ...(extraUsage ? { extraUsage } : {}),
      raw: data,
    };
  } catch (err) {
    return { error: err.message || "Failed to fetch Factory usage" };
  }
}
