export const DEFAULT_CODEX_QUOTA = {
  mode: "headroom",
  sessionCeiling: 100,
  weeklyCeiling: 100,
  sessionRules: [{ upTo: 70, priority: 1 }, { upTo: 90, priority: 5 }, { upTo: 100, priority: 10 }],
  weeklyRules: [{ upTo: 70, priority: 1 }, { upTo: 90, priority: 5 }, { upTo: 100, priority: 10 }],
};

export function validateCodexQuota(config) {
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) return "Codex quota must be an object";
  const value = { ...DEFAULT_CODEX_QUOTA, ...config };
  if (!["headroom", "rules"].includes(value.mode)) return "Invalid Codex quota priority mode";
  for (const key of ["sessionCeiling", "weeklyCeiling"]) {
    if (!Number.isFinite(value[key]) || value[key] <= 0 || value[key] > 100) return `${key} must be greater than 0 and at most 100`;
  }
  for (const key of ["sessionRules", "weeklyRules"]) {
    const rules = value[key];
    if (!Array.isArray(rules) || !rules.length || rules.length > 20) return `${key} must contain 1–20 rules`;
    let previous = 0;
    for (const rule of rules) {
      if (!Number.isFinite(rule?.upTo) || rule.upTo <= previous || rule.upTo > 100 ||
          !Number.isFinite(rule?.priority) || rule.priority < 1 || rule.priority > 10000) {
        return `${key}: thresholds must increase within (0, 100]; priorities must be within [1, 10000]`;
      }
      previous = rule.upTo;
    }
  }
  return null;
}

// Lower priority means more traffic; both windows must have usable allowance.
export function getCodexQuotaPriority(quotas, savedConfig, model, now = Date.now()) {
  const config = { ...DEFAULT_CODEX_QUOTA, ...(validateCodexQuota(savedConfig) ? {} : savedConfig) };
  const prefix = String(model || "").toLowerCase().includes("spark") ? "spark_" : "";
  let priority = 1;
  let known = false;
  let blocked = false;
  let retryAt = 0;
  for (const window of ["session", "weekly"]) {
    const quota = quotas?.[`${prefix}${window}`];
    const resetAt = Date.parse(quota?.resetAt);
    if (!Number.isFinite(quota?.used) || quota.used < 0 || quota.used > 100 || resetAt <= now) continue;
    known = true;
    const rules = config[`${window}Rules`];
    const ceiling = config.mode === "rules" ? rules.at(-1).upTo : config[`${window}Ceiling`];
    const rule = rules.find((entry) => quota.used <= entry.upTo);
    if (quota.used >= ceiling || (config.mode === "rules" && !rule)) {
      blocked = true;
      retryAt = Math.max(retryAt, Number.isFinite(resetAt) ? resetAt : now + 60_000);
    } else {
      priority = Math.max(priority, config.mode === "rules" ? rule.priority : 100 / (ceiling - quota.used));
    }
  }
  return { priority, known, blocked, retryAt };
}