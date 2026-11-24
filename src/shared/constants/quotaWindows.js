/**
 * Account-wide quota windows that a per-connection "quota reserve" can target.
 *
 * Usage handlers name their windows differently (codex `session`/`weekly`, claude `session (5h)`,
 * opencode-go `Rolling`/`Weekly`/`Monthly`, grok-cli `Weekly SuperGrok`...). These helpers map the
 * account-wide ones onto 5h / 7d / 30d. Per-model or per-feature pools (claude `weekly sonnet (7d)`,
 * codex `review_weekly`, minimax `<Model> (5h)`) are left out: they do not describe the whole account.
 */

export const QUOTA_WINDOWS = [
  { id: "5h", label: "5h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

const WINDOW_PATTERNS = [
  ["5h", /^(session|rolling)(\s*\(\s*\d+\s*h\s*\))?$/i],
  ["7d", /^weekly(\s*\(\s*7\s*d\s*\))?$/i],
  ["7d", /^weekly supergrok$/i],
  ["30d", /^monthly(\s+included)?(\s*\(\s*30\s*d\s*\))?$/i],
];

/** Windows each provider's usage handler reports, in display order (drives the reserve inputs). */
export const PROVIDER_QUOTA_WINDOWS = {
  codex: ["5h", "7d"],
  claude: ["5h", "7d"],
  glm: ["5h", "7d"],
  "glm-cn": ["5h", "7d"],
  commandcode: ["5h", "7d"],
  ollama: ["5h", "7d", "30d"],
  qoder: ["5h", "7d"],
  "opencode-go": ["5h", "7d", "30d"],
  "opencode-zen": ["5h", "7d", "30d"],
  kimi: ["7d"],
  "xiaomi-mimo": ["7d"],
  "grok-cli": ["7d", "30d"],
};

export function quotaWindowOf(key) {
  const name = String(key || "").trim();
  for (const [windowId, pattern] of WINDOW_PATTERNS) {
    if (pattern.test(name)) return windowId;
  }
  return null;
}

/** Remaining share of a usage quota in percent (0-100), or null when it cannot be told. */
export function remainingPercent(quota) {
  if (!quota || typeof quota !== "object") return null;
  if (quota.unlimited) return 100;
  if (Number.isFinite(quota.remainingPercentage)) return clamp(quota.remainingPercentage);
  const total = Number(quota.total);
  const remaining = Number(quota.remaining);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(remaining)) return clamp((remaining / total) * 100);
  const used = Number(quota.used);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(used)) return clamp(100 - (used / total) * 100);
  return null;
}

/**
 * Collapse a usage `quotas` object into { "5h": { remaining, resetAt }, ... }. When several keys land
 * on the same window, the tightest one wins.
 */
export function accountQuotaWindows(quotas) {
  const out = {};
  for (const [key, quota] of Object.entries(quotas || {})) {
    const windowId = quotaWindowOf(key);
    const remaining = windowId ? remainingPercent(quota) : null;
    if (remaining == null) continue;
    if (!out[windowId] || remaining < out[windowId].remaining) {
      out[windowId] = { remaining, resetAt: quota.resetAt || null };
    }
  }
  return out;
}

/** The reserve a connection keeps, as { "5h": 20, "7d": 10 }; only windows set to 1-99 count. */
export function normalizeQuotaReserve(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const { id } of QUOTA_WINDOWS) {
    const pct = Number(value[id]);
    if (Number.isFinite(pct) && pct > 0 && pct < 100) out[id] = Math.round(pct);
  }
  return out;
}

function clamp(n) {
  return Math.max(0, Math.min(100, Number(n)));
}
