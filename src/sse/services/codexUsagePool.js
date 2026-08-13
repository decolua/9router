/**
 * Pure pooling math for Codex rate-limit windows.
 *
 * Split out from codexPooledUsage.js (which reaches into the DB and the
 * upstream usage API) so the arithmetic can be exercised on its own.
 */

// Per-plan credit allowance per window. Relative weight is what matters here:
// these set how much each account contributes to the pool. Values mirror the
// published ChatGPT plan allowances.
export const PLAN_CAPACITY = {
  primary: {
    // ChatGPT publishes no 5h credit allowance for Free — but a Free account
    // still reports a real primary used_percent and still serves requests, so
    // weighting it 0 would drop it from the pool the moment a paid account
    // joins. Estimate its share from the ratio it holds on the weekly window,
    // where a Free allowance *is* published: 225 × (1134 / 7560).
    free: 33.75,
    plus: 225, business: 225, team: 225, edu: 225,
    pro: 1500, prolite: 1125, enterprise: 1500,
  },
  secondary: {
    free: 1134, plus: 7560, business: 7560, team: 7560, edu: 7560,
    pro: 50400, prolite: 37800, enterprise: 50400,
  },
};

export const WINDOW_MINUTES = { primary: 300, secondary: 10080 };

// getCodexUsage names the 5h window "session" and the weekly one "weekly".
export const QUOTA_KEY = { primary: "session", secondary: "weekly" };

// An account whose plan we cannot read still spends real quota. Weight it as
// Plus so it is counted rather than silently dropped from the pool.
const FALLBACK_PLAN = "plus";

export function normalizePlan(plan) {
  const normalized = String(plan || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized || normalized === "unknown") return FALLBACK_PLAN;
  // "prolite" before "pro" — the generic match would swallow it.
  if (normalized.includes("prolite")) return "prolite";
  if (normalized.includes("enterprise")) return "enterprise";
  if (normalized.includes("business")) return "business";
  if (normalized.includes("team")) return "team";
  if (normalized.includes("pro")) return "pro";
  if (normalized.includes("plus")) return "plus";
  if (normalized.includes("edu")) return "edu";
  if (normalized.includes("free")) return "free";
  return FALLBACK_PLAN;
}

export function capacityFor(plan, window) {
  const table = PLAN_CAPACITY[window];
  const capacity = table[normalizePlan(plan)];
  return Number.isFinite(capacity) ? capacity : table[FALLBACK_PLAN];
}

/**
 * Pool one window across accounts: Σ(capacity × used%) / Σ(capacity), so a Pro
 * account outweighs a Plus one. Two Plus accounts at 60% and 20% pool to 40%.
 * The reported reset is the earliest across accounts — when capacity returns.
 *
 * @param {Array<{plan?: string, quotas?: Object}>} usages getCodexUsage results
 * @param {"primary"|"secondary"} window
 * @returns {{usedPercent: number, resetAt: number|null}|null} null when no account reports the window
 */
export function poolWindow(usages, window) {
  const key = QUOTA_KEY[window];
  let totalCapacity = 0;
  let totalUsed = 0;
  let resetAt = null;
  // Some plans publish no allowance for a window (Free has no 5h credit
  // budget), which would zero out the weighting and drop the window entirely.
  // Those accounts still report a percentage, so fall back to weighting them
  // equally rather than reporting nothing.
  const percents = [];

  for (const usage of usages) {
    const quota = usage.quotas?.[key];
    if (!quota || !Number.isFinite(quota.used)) continue;

    percents.push(quota.used);
    const capacity = capacityFor(usage.plan, window);
    if (capacity > 0) {
      totalCapacity += capacity;
      totalUsed += (capacity * quota.used) / 100;
    }

    const reset = quota.resetAt ? new Date(quota.resetAt).getTime() : null;
    if (Number.isFinite(reset) && (resetAt === null || reset < resetAt)) resetAt = reset;
  }

  if (percents.length === 0) return null;
  const usedPercent = totalCapacity > 0
    ? (totalUsed / totalCapacity) * 100
    : percents.reduce((sum, p) => sum + p, 0) / percents.length;

  return { usedPercent, resetAt };
}

/**
 * Build the `x-codex-*` headers the Codex CLI reads its usage bar from.
 * @param {Array<{plan?: string, quotas?: Object}>} usages
 * @returns {Record<string, string>}
 */
export function buildRateLimitHeaders(usages) {
  const headers = {};
  for (const window of ["primary", "secondary"]) {
    const pooled = poolWindow(usages, window);
    if (!pooled) continue;
    headers[`x-codex-${window}-used-percent`] = String(Math.round(pooled.usedPercent * 100) / 100);
    headers[`x-codex-${window}-window-minutes`] = String(WINDOW_MINUTES[window]);
    if (pooled.resetAt !== null) {
      headers[`x-codex-${window}-reset-at`] = String(Math.floor(pooled.resetAt / 1000));
    }
  }
  return headers;
}
