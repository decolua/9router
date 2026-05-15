import { getApiKeyByKey } from "@/lib/localDb";
import { getApiKeyDailyTokenUsage } from "@/lib/usageDb";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

function normalizeModelId(model) {
  return typeof model === "string" ? model.trim().toLowerCase() : "";
}

function nextLocalMidnightIso(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next.toISOString();
}

export async function loadApiKeyPolicy(apiKey) {
  if (!apiKey) return null;
  return getApiKeyByKey(apiKey);
}

export function checkApiKeyExpiry(apiKeyRecord, now = new Date()) {
  if (!apiKeyRecord) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "Invalid API key" };
  }
  if (!apiKeyRecord.isActive) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "API key is inactive" };
  }
  if (apiKeyRecord.expiresAt && new Date(apiKeyRecord.expiresAt).getTime() <= now.getTime()) {
    return { allowed: false, status: HTTP_STATUS.UNAUTHORIZED, message: "API key has expired" };
  }
  return { allowed: true };
}

export function checkApiKeyModelAccess(apiKeyRecord, { requestedModel, resolvedModels = [] } = {}) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return { allowed: true };

  const candidates = [requestedModel, ...resolvedModels].map(normalizeModelId).filter(Boolean);
  const allowed = candidates.length > 0 && candidates.some((model) => allowedSet.has(model));
  if (allowed) return { allowed: true };

  return {
    allowed: false,
    status: HTTP_STATUS.FORBIDDEN,
    message: `Model is not allowed for this API key: ${requestedModel || resolvedModels[0] || "unknown"}`,
  };
}

export function checkApiKeyComboModelAccess(apiKeyRecord, comboName, comboModels = []) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return { allowed: true };
  if (allowedSet.has(normalizeModelId(comboName))) return { allowed: true };

  const normalizedModels = comboModels.map(normalizeModelId).filter(Boolean);
  const allComboModelsAllowed = normalizedModels.length > 0 && normalizedModels.every((model) => allowedSet.has(model));
  if (allComboModelsAllowed) return { allowed: true };

  return {
    allowed: false,
    status: HTTP_STATUS.FORBIDDEN,
    message: `Combo is not allowed for this API key: ${comboName || "unknown"}`,
  };
}

export async function checkApiKeyDailyTokenLimit(apiKeyRecord, date = new Date()) {
  const limit = Number(apiKeyRecord?.dailyTokenLimit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true };

  const usage = await getApiKeyDailyTokenUsage(apiKeyRecord.key, date);
  if (usage.totalTokens < limit) {
    return {
      allowed: true,
      limit,
      usage,
      remaining: Math.max(0, limit - usage.totalTokens),
      resetAt: nextLocalMidnightIso(date),
    };
  }

  return {
    allowed: false,
    status: HTTP_STATUS.RATE_LIMITED,
    message: `API key daily token limit exceeded (${usage.totalTokens}/${limit})`,
    limit,
    usage,
    remaining: 0,
    resetAt: nextLocalMidnightIso(date),
  };
}

export function filterModelsByApiKeyPolicy(models, apiKeyRecord) {
  const allowedModels = Array.isArray(apiKeyRecord?.allowedModels) ? apiKeyRecord.allowedModels : [];
  const allowedSet = new Set(allowedModels.map(normalizeModelId).filter(Boolean));
  if (allowedSet.size === 0) return models;
  return models.filter((model) => allowedSet.has(normalizeModelId(model?.id)));
}
