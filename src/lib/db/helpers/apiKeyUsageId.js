import { createHash } from "node:crypto";

const API_KEY_USAGE_ID_RE = /^sha256:[0-9a-f]{16}$/i;

export function isApiKeyUsageId(value) {
  return typeof value === "string" && API_KEY_USAGE_ID_RE.test(value);
}

export function createApiKeyUsageId(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  return `sha256:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

export function normalizeApiKeyUsageId(value) {
  if (!value || typeof value !== "string") return null;
  if (isApiKeyUsageId(value)) return value.toLowerCase();
  return createApiKeyUsageId(value);
}

export function normalizeUsageDailySummary(day) {
  if (!day || typeof day !== "object" || !day.byApiKey || typeof day.byApiKey !== "object") return day;

  const normalized = {};
  for (const [legacyKey, value] of Object.entries(day.byApiKey)) {
    const entry = value && typeof value === "object" ? { ...value } : {};
    const parts = String(legacyKey).split("|");
    const legacyApiKey = parts[0] && parts[0] !== "local-no-key" ? parts[0] : null;
    const rawModel = entry.rawModel || parts[1] || "";
    const provider = entry.provider || parts[2] || "unknown";
    const apiKeyId = normalizeApiKeyUsageId(entry.apiKey) || normalizeApiKeyUsageId(legacyApiKey);
    const apiKeyKey = apiKeyId || "local-no-key";
    const normalizedKey = `${apiKeyKey}|${rawModel}|${provider || "unknown"}`;

    const next = { ...entry, rawModel, provider, apiKey: apiKeyId };
    if (!normalized[normalizedKey]) {
      normalized[normalizedKey] = next;
      continue;
    }

    normalized[normalizedKey].requests = (normalized[normalizedKey].requests || 0) + (next.requests || 0);
    normalized[normalizedKey].promptTokens = (normalized[normalizedKey].promptTokens || 0) + (next.promptTokens || 0);
    normalized[normalizedKey].completionTokens = (normalized[normalizedKey].completionTokens || 0) + (next.completionTokens || 0);
    normalized[normalizedKey].cost = (normalized[normalizedKey].cost || 0) + (next.cost || 0);
  }

  return { ...day, byApiKey: normalized };
}
