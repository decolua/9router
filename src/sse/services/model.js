// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import fs from "node:fs";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const SELECTOR_QUARANTINE_FILE = "/opt/openclaw-hermes-os/runtime/model-selector/quarantine.json";

function getSelectorQuarantinedModels() {
  try {
    const raw = fs.readFileSync(SELECTOR_QUARANTINE_FILE, "utf8");
    const entries = JSON.parse(raw);
    const now = Date.now();
    const active = new Set();

    for (const [modelId, until] of Object.entries(entries || {})) {
      const expiresAt = Date.parse(until);
      if (Number.isFinite(expiresAt) && expiresAt > now) {
        active.add(modelId);
      }
    }

    return active;
  } catch {
    return new Set();
  }
}

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

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

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

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
  if (!combo || !combo.models || combo.models.length === 0) {
    return null;
  }

  // Respect 9Router's persistent disabled-model registry so models disabled
  // from the dashboard or shared selector are also excluded from combos.
  const disabled = await getDisabledModels();
  const quarantined = getSelectorQuarantinedModels();

  const activeModels = combo.models.filter((member) => {
    if (quarantined.has(member)) {
      return false;
    }
    if (typeof member !== "string" || !member.includes("/")) {
      return true;
    }

    const parsed = parseModel(member);
    const slash = member.indexOf("/");
    const rawAlias = member.slice(0, slash);
    const rawModel = member.slice(slash + 1);

    const aliases = new Set([
      rawAlias,
      parsed?.providerAlias,
      parsed?.provider,
    ].filter(Boolean));

    for (const alias of aliases) {
      const ids = disabled?.[alias];
      if (!Array.isArray(ids)) continue;

      if (
        ids.includes(rawModel) ||
        ids.includes(member) ||
        (parsed?.model && ids.includes(parsed.model))
      ) {
        return false;
      }
    }

    return true;
  });

  return activeModels.length > 0 ? activeModels : null;
}
