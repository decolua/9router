// Reset order is independent of saved manual priorities.
export const ACCOUNT_SELECTION_STRATEGIES = [
  "fill-first", "round-robin", "random",
  "weekly-reset-asc", "weekly-reset-desc", "session-reset-asc", "session-reset-desc",
];
export const WINDOW_ORDER_PROVIDERS = ["claude", "codex"];
export const SNAPSHOT_MAX_AGE_MS = 600_000;

export function isWindowStrategy(strategy) {
  return ACCOUNT_SELECTION_STRATEGIES.includes(strategy) && /^(weekly|session)-reset-/.test(strategy);
}

function timestamp(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return typeof value === "number" ? value : Date.parse(value);
}

export function getAccountWindowReset(snapshot, strategy, model = null, now = Date.now()) {
  if (!isWindowStrategy(strategy) || !snapshot) return null;
  const fetchedAt = timestamp(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt >= SNAPSHOT_MAX_AGE_MS) return null;
  const weekly = strategy.startsWith("weekly-");
  const quotas = snapshot.quotas || {};
  // ponytail: Claude/Codex only. Add explicit provider/family mappings before enabling others.
  const quota = weekly ? (quotas.weekly || quotas["weekly (7d)"]) : (quotas.session || quotas["session (5h)"]);
  if (weekly && model) {
    const name = String(model).toLowerCase();
    const scoped = Object.entries(quotas).filter(([key]) => {
      const family = /^weekly (.+) \(7d\)$/.exec(key)?.[1];
      return family && new RegExp(`(^|[^a-z0-9])${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(name);
    }).map(([, value]) => value);
    // An account-wide and a model-scoped window can both constrain this request.
    const resets = [quota, ...scoped].filter(q => q && q.unlimited !== true)
      .map(q => timestamp(q.resetAt)).filter(t => Number.isFinite(t) && t > now);
    return resets.length ? Math.min(...resets) : null;
  }
  if (!quota || quota.unlimited === true) return null;
  const reset = timestamp(quota.resetAt);
  return Number.isFinite(reset) && reset > now ? reset : null;
}

export function orderAccountsByWindow(connections, strategy, snapshots, model = null, now = Date.now()) {
  const resets = new Map(connections.map(c => [c.id, getAccountWindowReset(snapshots?.[c.id], strategy, model, now)]));
  return [...connections].sort((a, b) => {
    const left = resets.get(a.id);
    const right = resets.get(b.id);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== null && right !== null && left !== right) return (left - right) * (strategy.endsWith("-desc") ? -1 : 1);
    return (a.priority ?? 999) - (b.priority ?? 999) || String(a.id).localeCompare(String(b.id));
  });
}

export function validateAccountSelectionSettings(body) {
  const validLimit = value => Number.isSafeInteger(value) && value >= 1;
  if (Object.hasOwn(body, "fallbackStrategy") && !["fill-first", "round-robin", "random"].includes(body.fallbackStrategy)) return "Invalid global account selection strategy";
  if (Object.hasOwn(body, "stickyRoundRobinLimit") && !validLimit(body.stickyRoundRobinLimit)) return "Sticky limit must be a positive integer";
  if (!Object.hasOwn(body, "providerStrategies")) return null;
  const entries = body.providerStrategies;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return "Invalid provider strategies";
  for (const [provider, override] of Object.entries(entries)) {
    if (!override || typeof override !== "object" || Array.isArray(override)) return "Invalid provider strategy override";
    if (Object.hasOwn(override, "fallbackStrategy")) {
      if (!ACCOUNT_SELECTION_STRATEGIES.includes(override.fallbackStrategy)) return "Invalid account selection strategy";
      if (isWindowStrategy(override.fallbackStrategy) && !WINDOW_ORDER_PROVIDERS.includes(provider)) return "Reset-window ordering is unavailable for this provider";
    }
    if (Object.hasOwn(override, "stickyRoundRobinLimit") && !validLimit(override.stickyRoundRobinLimit)) return "Sticky limit must be a positive integer";
  }
  return null;
}
