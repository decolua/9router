import { getApiKeyByValue } from "@/lib/localDb";

export const API_KEY_MODEL_KIND = {
  LLM: "llm",
  IMAGE: "image",
};

function cleanModelList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

function cleanQuotaPercent(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
}

export function sanitizeApiKeyAuthorization(value) {
  if (!value || value.enabled !== true) return null;
  const rawConnections = value.connections && typeof value.connections === "object" && !Array.isArray(value.connections)
    ? value.connections
    : {};

  const connections = {};
  for (const [connectionId, grant] of Object.entries(rawConnections)) {
    if (!connectionId || !grant || typeof grant !== "object" || Array.isArray(grant)) continue;
    const models = cleanModelList(grant.models);
    const imageModels = cleanModelList(grant.imageModels);
    const quotaPercent = cleanQuotaPercent(grant.quotaPercent);
    if (models.length || imageModels.length || quotaPercent !== null) {
      connections[connectionId] = { models, imageModels, quotaPercent };
    }
  }

  return {
    enabled: true,
    visionFallback: value.visionFallback === true,
    bareModelFallback: {
      codex: value.bareModelFallback?.codex === true,
      claude: value.bareModelFallback?.claude === true,
    },
    connections,
  };
}

export function isApiKeyRestricted(apiKeyRecord) {
  return apiKeyRecord?.authorization?.enabled === true;
}

export async function resolveApiKeyRecord(rawApiKey) {
  if (!rawApiKey) return null;
  return await getApiKeyByValue(rawApiKey);
}

export function modelGrantId(provider, model) {
  return `${provider}/${model}`;
}

export function getAuthorizedConnectionIds(apiKeyRecord, provider, model, kind = API_KEY_MODEL_KIND.LLM) {
  if (!isApiKeyRestricted(apiKeyRecord)) return null;
  const field = kind === API_KEY_MODEL_KIND.IMAGE ? "imageModels" : "models";
  const grantId = modelGrantId(provider, model);
  return Object.entries(apiKeyRecord.authorization.connections || {})
    .filter(([, grant]) => Array.isArray(grant?.[field]) && grant[field].includes(grantId))
    .map(([connectionId]) => connectionId);
}

export function canUseModel(apiKeyRecord, provider, model, kind = API_KEY_MODEL_KIND.LLM) {
  const ids = getAuthorizedConnectionIds(apiKeyRecord, provider, model, kind);
  return ids === null || ids.length > 0;
}

export function canUseVisionFallback(apiKeyRecord) {
  return !isApiKeyRestricted(apiKeyRecord) || apiKeyRecord.authorization.visionFallback === true;
}

export function getApiKeyQuotaPercent(apiKeyRecord, connectionId) {
  if (!isApiKeyRestricted(apiKeyRecord)) return null;
  return cleanQuotaPercent(apiKeyRecord.authorization.connections?.[connectionId]?.quotaPercent);
}

export function resolveAuthorizedBareModel(apiKeyRecord, model) {
  if (!isApiKeyRestricted(apiKeyRecord) || typeof model !== "string" || model.includes("/")) return null;
  const fallback = apiKeyRecord.authorization.bareModelFallback || {};
  if (fallback.codex === true && model.startsWith("gpt-") && canUseModel(apiKeyRecord, "codex", model)) {
    return `cx/${model}`;
  }
  if (fallback.claude === true && model.startsWith("claude-") && canUseModel(apiKeyRecord, "claude", model)) {
    return `cc/${model}`;
  }
  return null;
}
