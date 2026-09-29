import { RESILIENCE_FEATURES, RESILIENCE_PROFILES } from "../config/resilienceConfig.js";
import { getProviderCategory } from "../providers/index.js";

const events = new Map();
const dedup = new Map();
const ELIGIBLE_STATUSES = new Set([408, 500, 502, 503, 504]);
const DEDUP_WINDOW_MS = 5000;

const keyOf = (provider, bucket) => `${provider}\u0000${bucket}`;

function eligible(input = {}) {
  return input.origin === "upstream_timeout"
    || (input.origin === "upstream_http" && ELIGIBLE_STATUSES.has(Number(input.status)));
}

function profile(provider) {
  return RESILIENCE_PROFILES[getProviderCategory(provider)] || RESILIENCE_PROFILES.unknown;
}

function prune(key, now) {
  const list = events.get(key) || [];
  const cutoff = now - profile(key.split("\u0000")[0]).windowMs;
  const kept = list.filter((time) => time >= cutoff);
  if (kept.length) events.set(key, kept);
  else events.delete(key);
  return kept;
}

export function recordProviderFailure(input = {}, now = Date.now()) {
  if (!RESILIENCE_FEATURES.tracker || !eligible(input) || !input.provider || !input.bucket) {
    return {
      recorded: false,
      count: getProviderFailureCount(input.provider, input.bucket, now),
    };
  }

  const key = keyOf(input.provider, input.bucket);
  const dedupKey = `${key}\u0000${input.connectionId || ""}`;
  const previous = dedup.get(dedupKey);
  if (previous !== undefined && now - previous < DEDUP_WINDOW_MS) {
    return { recorded: false, deduplicated: true, count: prune(key, now).length };
  }

  dedup.set(dedupKey, now);
  const list = prune(key, now);
  list.push(now);
  events.set(key, list);
  return { recorded: true, count: list.length };
}

export function getProviderFailureCount(provider, bucket, now = Date.now()) {
  if (!provider || !bucket) return 0;
  return prune(keyOf(provider, bucket), now).length;
}

export function clearProviderFailureBucket(provider, bucket) {
  events.delete(keyOf(provider, bucket));
  for (const key of dedup.keys()) {
    if (key.startsWith(`${provider}\u0000${bucket}\u0000`)) dedup.delete(key);
  }
}

export function getProviderFailureSnapshot(provider, bucket, now = Date.now()) {
  return {
    count: getProviderFailureCount(provider, bucket, now),
    timestamps: [...(events.get(keyOf(provider, bucket)) || [])],
  };
}

export function resetProviderFailureTracker() {
  events.clear();
  dedup.clear();
}

export const isEligibleProviderFailure = eligible;
