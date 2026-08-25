import { RESILIENCE_FEATURES } from "./resilienceConfig.js";
export const HARD_QUOTA_PROVIDERS = Object.freeze(["claude", "codex"]);
export const HARD_QUOTA_LOCK_DURATION_MS = 5 * 60 * 60 * 1000;
export const HARD_QUOTA_POLICY_ENABLED = RESILIENCE_FEATURES.hardQuota;
