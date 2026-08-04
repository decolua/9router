/**
 * Qoder quota/usage (Bearer, not Cosy).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { resolveProfile } from "./profile.js";

/**
 * @param {string} accessToken
 * @param {object} [options]
 * @param {any} [options.proxyOptions]
 * @param {any} [options.profile]
 */
export async function getQuota(accessToken, options = {}) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  const profile = resolveProfile(options.profile);
  try {
    const response = await proxyAwareFetch(
      profile.quotaUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          // CN's openapi rejects quota requests without this UA (401 even
          // with a valid token). Intl has no such constraint, so the header
          // is optional on the profile and only sent when set.
          ...(profile.quotaUserAgent ? { "User-Agent": profile.quotaUserAgent } : {}),
        },
      },
      options.proxyOptions ?? null,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // QoderWork splits credits across three layers (matching the client's
    // own Yt() sum). Each layer is stored separately so the tracker can
    // show one row per layer instead of collapsing them into one number.
    //   user         — base plan credits
    //   addOn        — Pro-upgrade / daily-checkin / purchased add-ons
    //   organization — org resource package
    const userQuota = body.userQuota || {};
    const addOnQuota = body.addOnQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const layer = (q) => ({
      total: Number(q.total) || 0,
      used: Number(q.used) || 0,
      remaining: Number(q.remaining) || 0,
      unit: q.unit || "credits",
      resetAt,
    });
    const quotas = {
      user: layer(userQuota),
      addOn: layer(addOnQuota),
      organization: layer(orgQuota),
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
