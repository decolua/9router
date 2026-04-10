export function formatUsageLimitValue(metric, value) {
  if (metric === "cost") {
    const numericValue = Number(value || 0);
    const decimals = numericValue >= 1 ? 2 : 4;
    return `$${numericValue.toFixed(decimals)}`;
  }
  return `${Number(value || 0).toFixed(0)} tokens`;
}

export function buildUsageLimitExceededMessage({ metric, current, limit }) {
  return `API key ${metric === "cost" ? "cost" : "tokens"} limit exceeded (${formatUsageLimitValue(metric, current)}/${formatUsageLimitValue(metric, limit)})`;
}

export function formatUsageLimitSummary(usageLimit = {}) {
  if (!usageLimit.enabled || !usageLimit.value) return "";
  return `${formatUsageLimitValue(usageLimit.metric, usageLimit.value)} / ${usageLimit.period || "daily"}`;
}
