// Per-API-key usage limits: pure helpers (no DB, no request objects).
import {
  KEY_USAGE_PERIODS,
  KEY_USAGE_METRICS,
  KEY_USAGE_MAX_VALUE,
  KEY_USAGE_WEEK_START_DAY,
  KEY_USAGE_NO_LIMITS,
} from "@/shared/constants/keyUsageLimit.js";

const DAYS_PER_WEEK = 7;

function isValidLimitValue(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= KEY_USAGE_MAX_VALUE;
}

/**
 * Normalize a limits object: keep known periods/metrics with valid numbers,
 * drop empty periods. Result: { daily?: {maxCost?, ...}, weekly?: ..., monthly?: ... }
 */
export function normalizeUsageLimits(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const period of KEY_USAGE_PERIODS) {
    const rule = input[period];
    if (!rule || typeof rule !== "object") continue;
    const clean = {};
    for (const metric of KEY_USAGE_METRICS) {
      if (isValidLimitValue(rule[metric])) clean[metric] = rule[metric];
    }
    if (Object.keys(clean).length) out[period] = clean;
  }
  return out;
}

export function hasUsageLimits(limits) {
  return !!limits && Object.keys(limits).length > 0;
}

export function usageLimitsFromColumn(col) {
  if (typeof col !== "string" || !col) return {};
  try { return normalizeUsageLimits(JSON.parse(col)); } catch { return {}; }
}

export function usageLimitsToColumn(limits) {
  const value = normalizeUsageLimits(limits || KEY_USAGE_NO_LIMITS);
  return hasUsageLimits(value) ? JSON.stringify(value) : null;
}

/**
 * Validate client input for a usageLimits update. Rejects rather than repairs.
 * Accepts null (clear all limits). Per metric: number >= 0, or null = no limit.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateUsageLimitsInput(input) {
  if (input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "usageLimits must be an object { daily, weekly, monthly }" };
  }
  const extraPeriods = Object.keys(input).filter((k) => !KEY_USAGE_PERIODS.includes(k));
  if (extraPeriods.length) return { ok: false, error: `usageLimits: unexpected period(s) ${extraPeriods.join(", ")}` };

  for (const period of KEY_USAGE_PERIODS) {
    const rule = input[period];
    if (rule === undefined || rule === null) continue;
    if (typeof rule !== "object" || Array.isArray(rule)) {
      return { ok: false, error: `usageLimits.${period} must be an object` };
    }
    const extraMetrics = Object.keys(rule).filter((k) => !KEY_USAGE_METRICS.includes(k));
    if (extraMetrics.length) return { ok: false, error: `usageLimits.${period}: unexpected field(s) ${extraMetrics.join(", ")}` };
    for (const metric of KEY_USAGE_METRICS) {
      const v = rule[metric];
      if (v === undefined || v === null) continue;
      if (!isValidLimitValue(v)) {
        return { ok: false, error: `usageLimits.${period}.${metric} must be a number between 0 and ${KEY_USAGE_MAX_VALUE}` };
      }
    }
  }
  return { ok: true, value: normalizeUsageLimits(input) };
}

/** Start of the current period, in server local time. */
export function getPeriodStart(period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "weekly") {
    const offset = (d.getDay() - KEY_USAGE_WEEK_START_DAY + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    d.setDate(d.getDate() - offset);
  } else if (period === "monthly") {
    d.setDate(1);
  }
  return d;
}

/** Start of the next period (= when the current usage resets). */
export function getPeriodEnd(period, now = new Date()) {
  const d = getPeriodStart(period, now);
  if (period === "weekly") d.setDate(d.getDate() + DAYS_PER_WEEK);
  else if (period === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 1);
  return d;
}

/** Current value of a metric from a usage aggregate { inputTokens, outputTokens, cost }. */
export function getMetricValue(metric, usage) {
  const input = usage?.inputTokens || 0;
  const output = usage?.outputTokens || 0;
  switch (metric) {
    case "maxCost": return usage?.cost || 0;
    case "maxTokens": return input + output;
    case "maxInputTokens": return input;
    case "maxOutputTokens": return output;
    default: return 0;
  }
}

/**
 * First exhausted limit, or null.
 * @param {object} limits - normalized usageLimits
 * @param {object} usageByPeriod - { daily: {inputTokens, outputTokens, cost}, ... }
 */
export function findExceededLimit(limits, usageByPeriod) {
  for (const period of KEY_USAGE_PERIODS) {
    const rule = limits?.[period];
    if (!rule) continue;
    for (const metric of KEY_USAGE_METRICS) {
      const max = rule[metric];
      if (max === undefined) continue;
      const used = getMetricValue(metric, usageByPeriod?.[period]);
      if (used >= max) return { period, metric, used, max };
    }
  }
  return null;
}
