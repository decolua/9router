/**
 * Kenari quota usage — GET https://kenari.id/v1/account/quota.
 * The API reports rolling month and week Rupiah windows, normalized separately
 * so the dashboard can show each reset schedule without hiding either amount.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const QUOTA_URL = "https://kenari.id/v1/account/quota";
const REQUEST_TIMEOUT_MS = 10000;

function buildQuota(window) {
  if (!window || typeof window !== "object") return null;

  const used = Number(window.used_rp);
  const remaining = Number(window.remaining_rp);
  if (!Number.isFinite(used) || !Number.isFinite(remaining) || used < 0 || remaining < 0) {
    return null;
  }

  return {
    used,
    total: used + remaining,
    resetAt: typeof window.resets_at === "string" ? window.resets_at : null,
  };
}

function isSharedKeyError(body) {
  if (typeof body === "string") return body.includes("shared_key_not_allowed");
  return body?.error === "shared_key_not_allowed" || body?.error?.code === "shared_key_not_allowed";
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getKenariUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "API key required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await proxyAwareFetch(
      QUOTA_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
      proxyOptions,
    );
    const bodyText = await response.text();
    let body = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {}

    if (response.status === 403 && isSharedKeyError(body)) {
      return { plan: "kenari", message: "Balance view requires a non-shared API key" };
    }

    if (response.status === 401 || response.status === 403) {
      return { plan: "kenari", message: "Authentication failed — check your kenari API key" };
    }

    if (!response.ok || !body || typeof body !== "object") {
      return { plan: "kenari", message: "Balance unavailable" };
    }

    const plan = body.plan;
    const month = buildQuota(plan?.windows?.month);
    const week = buildQuota(plan?.windows?.week);
    const quotas = {};
    if (month) quotas["Month (IDR)"] = month;
    if (week) quotas["Week (IDR)"] = week;

    if (Object.keys(quotas).length === 0) {
      return { plan: "kenari", message: "Balance unavailable" };
    }

    return { plan: typeof plan?.name === "string" && plan.name.trim() ? plan.name : "kenari", quotas };
  } catch {
    return { plan: "kenari", message: "Balance unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
