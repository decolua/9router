// Per-API-key limits: hard expiry + independent USD budgets over a rolling
// 5-hour window (like Claude's session limit) and the calendar week / month.
// Calendar periods follow server local time, like the usage dashboard's day
// keys. Weeks start Monday.
export const FIVE_HOURS_MS = 5 * 3600 * 1000;
export const KEY_QUOTA_PERIODS = [
  { id: "5h", field: "quota5hUsd", label: "5-hour", short: "5h" },
  { id: "week", field: "quotaWeeklyUsd", label: "Weekly", short: "Week" },
  { id: "month", field: "quotaMonthlyUsd", label: "Monthly", short: "Month" },
];

/**
 * [start, end) of the period containing `now`. For the rolling 5h window `end`
 * is only a fallback: spend frees up when the oldest request in the window
 * ages out (see getApiKeyPeriodSpend).
 */
export function quotaPeriodBounds(period, now = new Date()) {
  if (period === "5h") return { start: new Date(now - FIVE_HOURS_MS), end: new Date(now.getTime() + FIVE_HOURS_MS) };
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (period === "month") return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  if (period === "week") {
    const monday = d - ((now.getDay() + 6) % 7);
    return { start: new Date(y, m, monday), end: new Date(y, m, monday + 7) };
  }
  throw new Error(`unknown quota period: ${period}`);
}

export function isKeyExpired(key, now = new Date()) {
  return !!key?.expiresAt && new Date(key.expiresAt) <= now;
}

/** Budgets the key actually has set: [{ id, field, label, limit }]. */
export function keyBudgets(key) {
  return KEY_QUOTA_PERIODS.filter((p) => key?.[p.field] > 0).map((p) => ({ ...p, limit: key[p.field] }));
}

/** Validates create/update limit fields. Only fields present in `input` are returned. */
export function validateKeyLimitsInput(input) {
  const value = {};
  if ("expiresAt" in input) {
    if (input.expiresAt === null || input.expiresAt === "") value.expiresAt = null;
    else {
      const d = new Date(input.expiresAt);
      if (Number.isNaN(d.getTime())) return { ok: false, error: "expiresAt must be a valid date" };
      value.expiresAt = d.toISOString();
    }
  }
  for (const { field, label } of KEY_QUOTA_PERIODS) {
    if (!(field in input)) continue;
    if (input[field] === null || input[field] === "") { value[field] = null; continue; }
    const n = Number(input[field]);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${label} budget must be a positive number` };
    value[field] = n;
  }
  return { ok: true, value };
}

/** Public limit status for one key (GET /v1/limits). `spend` from getApiKeyPeriodSpend. */
export function keyLimitStatus(key, spend, now = new Date()) {
  const expired = isKeyExpired(key, now);
  const limits = KEY_QUOTA_PERIODS.map(({ id, field, label }) => {
    const limit = key[field] > 0 ? key[field] : null;
    const used = spend?.[id]?.spent || 0;
    return {
      period: id,
      label,
      limit_usd: limit,
      used_usd: Number(used.toFixed(6)),
      remaining_usd: limit === null ? null : Number(Math.max(0, limit - used).toFixed(6)),
      utilization: limit === null ? null : Number((used / limit).toFixed(4)),
      resets_at: spend?.[id]?.end ? new Date(spend[id].end).toISOString() : null,
      blocked: limit !== null && used >= limit,
    };
  });
  return {
    object: "key_limits",
    name: key.name || null,
    expires_at: key.expiresAt || null,
    expired,
    blocked: expired || limits.some((l) => l.blocked),
    limits,
  };
}
