/**
 * Kimi Code usage handler
 *
 * Source of truth: Kimi CLI OAuth traffic to api.kimi.com
 *   GET /coding/v1/usages
 *
 * Observed shape — a top-level subscription window plus per-window limits,
 * with numbers sent as strings and durations as a {duration, timeUnit} pair:
 * {
 *   usage: { limit: "2048", used: "375", remaining, resetTime },
 *   limits: [{
 *     window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
 *     detail: { limit: "200", used: "19", remaining, resetTime }
 *   }]
 * }
 */

import { buildKimiHeaders } from "../../config/appConstants.js";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

// Kimi reports the rolling 5h session allowance as a 300-minute window.
const SESSION_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const WEEKLY_NAME = "weekly (7d)";

const WINDOW_UNIT_MINUTES = {
  TIME_UNIT_MINUTE: 1,
  TIME_UNIT_HOUR: 60,
  TIME_UNIT_DAY: 1440,
};

function normalizeQuota(detail) {
  if (!detail || typeof detail !== "object") return null;

  const total = toFiniteNumber(detail.limit, NaN);
  const used = toFiniteNumber(detail.used, NaN);
  if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0) return null;

  return { used, total, resetAt: parseResetTime(detail.resetTime) };
}

function windowMinutes(window) {
  const duration = toFiniteNumber(window?.duration, NaN);
  const unitMinutes = WINDOW_UNIT_MINUTES[window?.timeUnit];
  if (!Number.isFinite(duration) || duration <= 0 || !unitMinutes) return null;
  return duration * unitMinutes;
}

function formatSpan(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function getWindowName(window) {
  const minutes = windowMinutes(window);
  if (!minutes) return null;

  const span = formatSpan(minutes);
  if (minutes === SESSION_WINDOW_MINUTES) return `session (${span})`;
  if (minutes === WEEKLY_WINDOW_MINUTES) return WEEKLY_NAME;
  return `limit (${span})`;
}

function parseKimiUsage(data) {
  const quotas = {};
  const weekly = normalizeQuota(data?.usage);
  if (weekly) quotas[WEEKLY_NAME] = weekly;

  // A 7-day window here restates the top-level weekly allowance, so the
  // first-wins guard keeps `usage` authoritative rather than adding a duplicate row.
  for (const limit of Array.isArray(data?.limits) ? data.limits : []) {
    const name = getWindowName(limit?.window);
    const quota = normalizeQuota(limit?.detail);
    if (name && quota && !quotas[name]) quotas[name] = quota;
  }

  return quotas;
}

export async function getKimiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) return { message: "Kimi access token not available." };

  try {
    const response = await proxyAwareFetch(U("kimi").url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...buildKimiHeaders(providerSpecificData?.deviceId),
      },
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { message: "Kimi quota API authentication expired." };
      }
      return { message: `Kimi connected. Unable to fetch usage (${response.status}).` };
    }

    // A malformed body is a parse failure, not a transport failure: keep it out
    // of the outer catch so the JSON error text never reaches the dashboard.
    let quotas;
    try {
      quotas = parseKimiUsage(JSON.parse(await response.text()));
    } catch {
      quotas = {};
    }

    if (Object.keys(quotas).length === 0) {
      return { message: "Kimi connected. Unable to parse quota data.", quotas };
    }

    return { plan: "Kimi Code", quotas };
  } catch (error) {
    return { message: `Kimi connected. Unable to fetch usage: ${error.message}` };
  }
}
