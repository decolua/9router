export const API_CACHE_KEYS = {
  providersList: "api:providers:list:v1",
  providerNodesList: "api:provider-nodes:list:v1",
  usageProvidersList: "api:usage:providers:list:v1",
};

export const USAGE_CHART_PERIODS = ["24h", "7d", "30d", "60d"];

export function getUsageChartCacheKey(period) {
  return `api:usage:chart:${period}`;
}

export function getUsageConnectionCacheKey(connectionId) {
  return `api:usage:connection:${connectionId}`;
}

export function getProviderModelsCacheKey(connectionId) {
  return `api:providers:${connectionId}:models`;
}

export const LOCAL_DB_CACHE_KEYS = [
  API_CACHE_KEYS.providersList,
  API_CACHE_KEYS.providerNodesList,
  API_CACHE_KEYS.usageProvidersList,
];

export function getUsageChartCacheKeys() {
  return USAGE_CHART_PERIODS.map((period) => getUsageChartCacheKey(period));
}
