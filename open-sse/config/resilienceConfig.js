const CATEGORY_DEFAULTS = Object.freeze({
  oauth: Object.freeze({ failureThreshold: 10, windowMs: 15 * 60 * 1000, cooldownMs: 5 * 60 * 1000 }),
  apikey: Object.freeze({ failureThreshold: 5, windowMs: 30 * 1000, cooldownMs: 30 * 1000 }),
  local: Object.freeze({ failureThreshold: 2, windowMs: 5 * 60 * 1000, cooldownMs: 60 * 1000 }),
  free: Object.freeze({ failureThreshold: 5, windowMs: 30 * 1000, cooldownMs: 30 * 1000 }),
  unknown: Object.freeze({ failureThreshold: 5, windowMs: 30 * 1000, cooldownMs: 30 * 1000 }),
});

function envFlag(name, fallback = true) {
  const value = process.env[name];
  return value === undefined ? fallback : !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}

export const RESILIENCE_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(CATEGORY_DEFAULTS).map(([key, value]) => [key, Object.freeze({ ...value })]),
));
export const MAX_COOLDOWN_MS = 30 * 60 * 1000;
export const DEFAULT_SEMAPHORE_CONCURRENCY = 3;
export const DEFAULT_SEMAPHORE_QUEUE_SIZE = 20;
export const DEFAULT_SEMAPHORE_TIMEOUT_MS = 30 * 1000;
export const RESILIENCE_FEATURES = Object.freeze({
  breaker: envFlag("NINEROUTER_RESILIENCE_BREAKER"),
  semaphore: envFlag("NINEROUTER_RESILIENCE_SEMAPHORE"),
  tracker: envFlag("NINEROUTER_RESILIENCE_TRACKER"),
  hardQuota: envFlag("NINEROUTER_RESILIENCE_HARD_QUOTA"),
});
export function getDegradedThreshold(category) {
  const profile = RESILIENCE_PROFILES[category] || RESILIENCE_PROFILES.unknown;
  return Math.ceil(profile.failureThreshold / 2);
}
