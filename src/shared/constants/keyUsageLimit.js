// Per-API-key usage limits (cost + tokens per day/week/month). Shared by the
// DB repo, the /api/keys routes, the /v1 gate (src/dashboardGuard.js) and the
// Endpoint page.

export const KEY_USAGE_PERIODS = Object.freeze(["daily", "weekly", "monthly"]);

export const KEY_USAGE_PERIOD_LABELS = Object.freeze({
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
});

// Limit fields of one period rule. A missing/null field means "no limit".
export const KEY_USAGE_METRICS = Object.freeze(["maxCost", "maxTokens", "maxInputTokens", "maxOutputTokens"]);

export const KEY_USAGE_METRIC_LABELS = Object.freeze({
  maxCost: "Cost ($)",
  maxTokens: "Total tokens",
  maxInputTokens: "Input tokens",
  maxOutputTokens: "Output tokens",
});

// Upper bound accepted for any single limit value (rejects typos like 1e30).
export const KEY_USAGE_MAX_VALUE = 1e12;

// Week starts on Monday (ISO-8601).
export const KEY_USAGE_WEEK_START_DAY = 1;

export const KEY_USAGE_NO_LIMITS = Object.freeze({});

// Client-facing 429 message. Names only the exhausted period/metric, never the key.
export function keyUsageExceededMessage(period, metric, resetAt) {
  const periodLabel = KEY_USAGE_PERIOD_LABELS[period] || period;
  const metricLabel = KEY_USAGE_METRIC_LABELS[metric] || metric;
  return `This API key has reached its ${periodLabel.toLowerCase()} ${metricLabel.toLowerCase()} limit. Resets at ${resetAt}`;
}
