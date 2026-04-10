import { getSettings } from "@/lib/localDb";

const MODELS_DEV_URLS = (process.env.MODELS_DEV_URLS || "https://models.dev/api.json,https://models.dev/models.json")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const ENV_MODELS_DEV_CACHE_TTL_MS = Number.parseInt(process.env.MODELS_DEV_CACHE_TTL_MS, 10);
const MODELS_DEV_TIMEOUT_MS = Number.parseInt(process.env.MODELS_DEV_TIMEOUT_MS, 10) || 7000;
const MODELS_DEV_MAX_PARSE_DEPTH = Number.parseInt(process.env.MODELS_DEV_MAX_PARSE_DEPTH, 10) || 6;
const DEFAULT_MODELS_DEV_CACHE_TTL_MS = 60 * 60 * 1000;
const MODELS_DEV_CACHE_TTL_MINUTES_SETTING_KEY = "modelsDevCacheTtlMinutes";

let modelsDevCache = null;

const normalizeModelsDevModelId = (modelId) => {
  if (typeof modelId !== "string") return "";
  return modelId.trim().replace(/^models\//i, "").toLowerCase();
};

const parseNumericValue = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const firstDefinedNumber = (...values) => {
  for (const value of values) {
    const parsed = parseNumericValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const hasAnyTokenMetadata = ({ contextWindow, inputTokenLimit, outputTokenLimit }) =>
  contextWindow !== undefined || inputTokenLimit !== undefined || outputTokenLimit !== undefined;

const looksLikeContainerKey = (key) => {
  if (typeof key !== "string") return true;
  const normalized = key.trim().toLowerCase();
  return normalized === "" || ["data", "models", "model", "items", "results", "providers", "list", "entries", "metadata", "tokens"].includes(normalized);
};

const looksLikeTokenMetadataRecord = (value) => {
  if (!value || typeof value !== "object") return false;
  const tokenInfo = value?.tokens && typeof value.tokens === "object" ? value.tokens : null;
  return [
    value?.context_window,
    value?.contextWindow,
    value?.context_length,
    value?.contextLength,
    value?.context_size,
    value?.max_input_tokens,
    value?.maxInputTokens,
    value?.input_token_limit,
    value?.inputTokenLimit,
    value?.max_output_tokens,
    value?.maxOutputTokens,
    value?.output_token_limit,
    value?.outputTokenLimit,
    tokenInfo?.context_window,
    tokenInfo?.contextWindow,
    tokenInfo?.context_length,
    tokenInfo?.contextLength,
    tokenInfo?.max_input_tokens,
    tokenInfo?.maxInputTokens,
    tokenInfo?.max_output_tokens,
    tokenInfo?.maxOutputTokens,
  ].some((item) => item !== undefined && item !== null && item !== "");
};

const collectModelsDevRecords = (value, records, path = [], depth = 0) => {
  if (depth >= MODELS_DEV_MAX_PARSE_DEPTH || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectModelsDevRecords(item, records, path, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  const hasModelLikeId = typeof value.id === "string" || typeof value.model === "string" || typeof value.name === "string";
  if (hasModelLikeId) {
    records.push(value);
  } else if (looksLikeTokenMetadataRecord(value)) {
    const candidateKey = path[path.length - 1];
    if (!looksLikeContainerKey(candidateKey)) {
      records.push({ ...value, id: candidateKey });
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    if (nested && typeof nested === "object") {
      collectModelsDevRecords(nested, records, [...path, key], depth + 1);
    }
  }
};

const buildModelIdCandidates = (modelId) => {
  const normalized = normalizeModelsDevModelId(modelId);
  if (!normalized) return [];

  const candidates = new Set([normalized]);
  let current = normalized;
  while (current.includes("/")) {
    current = current.slice(current.indexOf("/") + 1);
    if (!current) break;
    candidates.add(current);
  }

  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex > -1 && slashIndex < normalized.length - 1) {
    candidates.add(normalized.slice(slashIndex + 1));
  }

  return [...candidates];
};

const buildModelsDevIndex = (payload) => {
  const records = [];
  const index = new Map();

  collectModelsDevRecords(payload, records);

  for (const record of records) {
    const rawId = record?.id || record?.model || record?.name;
    const providerName = typeof record?.provider === "string"
      ? record.provider
      : typeof record?.vendor === "string"
      ? record.vendor
      : typeof record?.organization === "string"
      ? record.organization
      : null;

    const tokenInfo = record?.tokens && typeof record.tokens === "object" ? record.tokens : {};
    const contextWindow = firstDefinedNumber(
      record?.context_window,
      record?.contextWindow,
      record?.context_length,
      record?.contextLength,
      record?.contextSize,
      record?.context_size,
      tokenInfo?.context_window,
      tokenInfo?.contextWindow,
      tokenInfo?.context_length,
      tokenInfo?.contextLength
    );
    const inputTokenLimit = firstDefinedNumber(
      record?.input_token_limit,
      record?.inputTokenLimit,
      record?.max_input_tokens,
      record?.maxInputTokens,
      record?.input_tokens,
      record?.inputTokens,
      tokenInfo?.input_token_limit,
      tokenInfo?.inputTokenLimit,
      tokenInfo?.max_input_tokens,
      tokenInfo?.maxInputTokens
    );
    const outputTokenLimit = firstDefinedNumber(
      record?.output_token_limit,
      record?.outputTokenLimit,
      record?.max_output_tokens,
      record?.maxOutputTokens,
      record?.max_completion_tokens,
      record?.maxCompletionTokens,
      record?.output_tokens,
      record?.outputTokens,
      tokenInfo?.output_token_limit,
      tokenInfo?.outputTokenLimit,
      tokenInfo?.max_output_tokens,
      tokenInfo?.maxOutputTokens,
      tokenInfo?.max_completion_tokens,
      tokenInfo?.maxCompletionTokens
    );

    if (!hasAnyTokenMetadata({ contextWindow, inputTokenLimit, outputTokenLimit })) continue;

    const metadata = {
      source: "models.dev",
      source_model_id: rawId,
      ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
      ...(inputTokenLimit !== undefined ? { max_input_tokens: inputTokenLimit } : {}),
      ...(outputTokenLimit !== undefined ? { max_output_tokens: outputTokenLimit } : {}),
    };

    const candidates = new Set(buildModelIdCandidates(rawId));
    const normalizedProvider = normalizeModelsDevModelId(providerName);
    if (normalizedProvider && typeof rawId === "string" && !String(rawId).includes("/")) {
      for (const candidate of buildModelIdCandidates(`${normalizedProvider}/${rawId}`)) {
        candidates.add(candidate);
      }
    }

    for (const key of candidates) {
      if (key && !index.has(key)) {
        index.set(key, metadata);
      }
    }
  }

  return index;
};

const resolveModelsDevCacheTtlMs = async () => {
  try {
    const settings = await getSettings();
    const ttlMinutes = Number.parseInt(settings?.[MODELS_DEV_CACHE_TTL_MINUTES_SETTING_KEY], 10);
    if (Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
      return ttlMinutes * 60 * 1000;
    }
  } catch {
    // ignore and fallback to env/default TTL
  }

  if (Number.isFinite(ENV_MODELS_DEV_CACHE_TTL_MS) && ENV_MODELS_DEV_CACHE_TTL_MS > 0) {
    return ENV_MODELS_DEV_CACHE_TTL_MS;
  }

  return DEFAULT_MODELS_DEV_CACHE_TTL_MS;
};

export async function fetchModelsDevIndex() {
  const now = Date.now();
  const cacheTtlMs = await resolveModelsDevCacheTtlMs();
  if (
    modelsDevCache &&
    modelsDevCache.ttlMs === cacheTtlMs &&
    now < modelsDevCache.expiresAt
  ) {
    return modelsDevCache.index;
  }

  const staleIndex = modelsDevCache?.index;

  for (const url of MODELS_DEV_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = await response.json();
      const index = buildModelsDevIndex(data);
      if (index.size === 0) continue;

      modelsDevCache = {
        index,
        ttlMs: cacheTtlMs,
        expiresAt: now + cacheTtlMs,
      };
      return index;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[models.dev] fetch failed (${url}):`, error?.message || error);
      }
      continue;
    }
  }

  return staleIndex || new Map();
}

export const findModelsDevMetadata = (modelsDevIndex, modelId) => {
  if (!modelsDevIndex || modelsDevIndex.size === 0 || typeof modelId !== "string") return null;

  for (const key of buildModelIdCandidates(modelId)) {
    const metadata = modelsDevIndex.get(key);
    if (metadata) return metadata;
  }

  return null;
};

export const enrichModelsWithModelsDevMetadata = (models, modelsDevIndex) =>
  models.map((model) => {
    const metadata = findModelsDevMetadata(
      modelsDevIndex,
      model?.root || model?.id,
    );
    if (!metadata) return model;
    return {
      ...model,
      ...metadata,
      ...(metadata.context_window !== undefined ? { token_size: metadata.context_window } : {}),
    };
  });
