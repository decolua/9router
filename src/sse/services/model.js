// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import { getProviderModels } from "open-sse/config/providerModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

// Cursor-native ids that often appear in the live catalog but not the static registry.
const CURSOR_NATIVE_ID = /^(composer(?:-|$)|cursor-)/i;

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * When Cursor IDE points its OpenAI base URL at 9router, it sends bare model ids
 * (gpt-5.6-sol, composer-2.5, …). Without a combo those used to infer as openai/
 * anthropic and fail with "No credentials for openai". Prefer cu/ when an active
 * Cursor connection can serve that catalog id.
 *
 * @param {string} modelId
 * @returns {Promise<{ provider: string, model: string }|null>}
 */
export async function resolveBareModelViaCursor(modelId) {
  if (!modelId || typeof modelId !== "string" || modelId.includes("/")) return null;

  let connections = [];
  try {
    connections = await getProviderConnections();
  } catch {
    return null;
  }

  const cursorConn = (connections || []).find(
    (c) => c.provider === "cursor" && c.isActive !== false
  );
  if (!cursorConn) return null;

  const staticIds = new Set((getProviderModels("cu") || []).map((m) => m.id));
  if (staticIds.has(modelId) || CURSOR_NATIVE_ID.test(modelId) || modelId === "default") {
    return { provider: "cursor", model: modelId };
  }

  try {
    const live = await resolveCursorModels({
      accessToken: cursorConn.accessToken,
      providerSpecificData: cursorConn.providerSpecificData || {},
    }, { log: console });
    if (live?.models?.some((m) => m.id === modelId)) {
      return { provider: "cursor", model: modelId };
    }
  } catch {
    // Fail open — fall through to normal alias / prefix inference.
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Combo with models → signal combo handling. Empty combos fall through so we
  // can still resolve via Cursor catalog / aliases instead of "Invalid model".
  const combo = await getComboByName(parsed.model);
  if (combo && Array.isArray(combo.models) && combo.models.length > 0) {
    return { provider: null, model: parsed.model };
  }

  // Explicit user aliases win over Cursor catalog preference.
  const aliases = await getModelAliases();
  const aliasHit =
    resolveModelAliasFromMap(parsed.model, aliases);
  if (aliasHit) return aliasHit;

  // Bare Cursor IDE model ids → cu/ when Cursor is connected.
  const viaCursor = await resolveBareModelViaCursor(parsed.model);
  if (viaCursor) return viaCursor;

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
