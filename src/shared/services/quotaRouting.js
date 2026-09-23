import { getModelQuotaFamily, getModelUpstreamId, getProviderModels } from "open-sse/config/providerModels.js";

export const QUOTA_ROUTING_PROVIDERS = Object.freeze(["codex", "claude", "antigravity", "gemini-cli"]);
export const QUOTA_ROUTING_MAX_AGE_MS = 600000;
export const QUOTA_ROUTING_REFRESH_MS = 300000;
const ALIASES = { codex: "cx", claude: "cc", antigravity: "ag", "gemini-cli": "gc" };
const numeric = (value) => typeof value === "number" && Number.isFinite(value);
const stripThinking = (value) => value.replace(/\([^()]+\)\s*$/, "").trim();

export function isQuotaResetFirstEnabled(settings, providerId) {
  return QUOTA_ROUTING_PROVIDERS.includes(providerId) && settings?.providerStrategies?.[providerId]?.quotaResetFirst === true;
}

export function hasQuotaResetFirstEnabled(settings) {
  return QUOTA_ROUTING_PROVIDERS.some((provider) => isQuotaResetFirstEnabled(settings, provider));
}

function fresh(observedAtMs, nowMs) {
  return numeric(nowMs) && numeric(observedAtMs) && observedAtMs > 0 && nowMs - observedAtMs <= QUOTA_ROUTING_MAX_AGE_MS && observedAtMs - nowMs <= 60000;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const resetMs = row.resetMs !== undefined ? row.resetMs : typeof row.resetAt === "string" ? Date.parse(row.resetAt) : row.resetAt;
  if (!numeric(resetMs) || resetMs <= 0 || resetMs > 8640000000000000) return null;
  if (row.unlimited !== undefined && typeof row.unlimited !== "boolean") return null;
  for (const key of ["remaining", "used", "total"]) {
    if (row[key] !== undefined && (!numeric(row[key]) || row[key] < 0)) return null;
  }
  if (numeric(row.total) && ((numeric(row.used) && row.used > row.total) || (numeric(row.remaining) && row.remaining > row.total))) return null;
  const remaining = row.remaining ?? (numeric(row.used) && numeric(row.total) && row.total > 0 ? row.total - row.used : null);
  if (!numeric(remaining) || (row.total !== undefined && row.total <= 0)) return null;
  return {
    resetMs,
    remaining,
    ...(row.used !== undefined ? { used: row.used } : {}),
    ...(row.total !== undefined ? { total: row.total } : {}),
    unlimited: row.unlimited === true,
  };
}

export function createQuotaRoutingSnapshot(provider, usage, nowMs = Date.now()) {
  if (!QUOTA_ROUTING_PROVIDERS.includes(provider) || !usage || typeof usage !== "object") return null;
  const observedAtMs = Object.hasOwn(usage, "observedAtMs") ? usage.observedAtMs : nowMs;
  if (!fresh(observedAtMs, nowMs) || !usage.quotas || typeof usage.quotas !== "object" || Array.isArray(usage.quotas)) return null;
  const quotas = {};
  for (const key of Object.keys(usage.quotas).slice(0, 256)) {
    if (!key || key.length > 200 || ["__proto__", "constructor", "prototype"].includes(key)) continue;
    const row = normalizeRow(usage.quotas[key]);
    if (row) quotas[key] = row;
  }
  return { version: 1, provider, observedAtMs, quotas };
}

function applicableKeys(provider, model) {
  if (typeof model !== "string" || !model.trim()) return [];
  const alias = ALIASES[provider];
  let id = stripThinking(model.trim());
  for (const prefix of [provider, alias]) {
    if (id.startsWith(`${prefix}/`)) {
      id = id.slice(prefix.length + 1);
      break;
    }
  }
  if (id.includes("/")) return [];
  const models = getProviderModels(alias);
  const entry = models.find((m) => m.id === id || m.name === id);
  if (entry) id = entry.id;
  if (provider === "codex") {
    const family = getModelQuotaFamily("cx", id);
    if (family === "review" || id.endsWith("-review")) return ["review_session", "review_weekly"];
    if (id === "gpt-5.3-codex-spark") return ["spark_session", "spark_weekly"];
    if (!entry || entry.kind === "image") return [];
    return ["session", "weekly"];
  }
  if (provider === "claude") {
    const family = id.toLowerCase().match(/(?:^|-)(sonnet|opus|fable|haiku)(?:-|$)/);
    if (!family || !id.startsWith("claude-")) return [];
    return ["session", "weekly", "session (5h)", "weekly (7d)", `weekly ${family[1]} (7d)`];
  }
  const upstream = stripThinking(getModelUpstreamId(alias, id));
  const keys = [id, upstream];
  if (provider === "antigravity") {
    const known = entry || models.find((m) => stripThinking(getModelUpstreamId(alias, m.id)) === id);
    if (known && !upstream.includes("image")) {
      if (upstream.startsWith("gemini-")) keys.push("gemini_weekly");
      if (/^(claude|gpt)-/.test(upstream)) keys.push("claude_gpt_weekly");
    }
  }
  return keys;
}

export function getConnectionQuotaReset(connection, model, nowMs = Date.now()) {
  if (connection?.authType !== "oauth") return null;
  const snapshot = connection.quotaRoutingSnapshot;
  if (snapshot?.version !== 1 || snapshot.provider !== connection.provider || !fresh(snapshot.observedAtMs, nowMs)) return null;
  if (!QUOTA_ROUTING_PROVIDERS.includes(connection.provider)) return null;
  if (!snapshot.quotas || typeof snapshot.quotas !== "object" || Array.isArray(snapshot.quotas)) return null;
  let resetMs = null;
  let blockedUntilMs = null;
  for (const key of applicableKeys(connection.provider, model)) {
    const row = normalizeRow(snapshot.quotas?.[key]);
    if (!row || row.unlimited || row.resetMs <= nowMs) continue;
    if (row.remaining <= 0 || (numeric(row.used) && numeric(row.total) && row.used >= row.total)) {
      blockedUntilMs = Math.max(blockedUntilMs || 0, row.resetMs);
    } else {
      resetMs = Math.min(resetMs ?? Infinity, row.resetMs);
    }
  }
  return resetMs !== null || blockedUntilMs !== null ? { resetMs, blockedUntilMs } : null;
}

export function preferEarliestQuotaReset(connections, model, nowMs = Date.now()) {
  const ranked = connections.map((connection) => ({ connection, resetMs: getConnectionQuotaReset(connection, model, nowMs)?.resetMs }));
  const earliest = ranked.reduce((minimum, item) => numeric(item.resetMs) ? Math.min(minimum, item.resetMs) : minimum, Infinity);
  return Number.isFinite(earliest) ? ranked.filter((item) => item.resetMs === earliest).map((item) => item.connection) : connections;
}
