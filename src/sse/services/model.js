// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { DEFAULT_COMBO_IDENTITY_PROMPT } from "open-sse/config/appConstants.js";

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
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Resolve the app-level default identity system prompt template (un-substituted,
 * still carrying its "{name}" placeholder). Falls back to the built-in hardened
 * template until a default is configured in Settings.
 * @param {object} [settings] - App settings blob (from getSettings())
 * @returns {string} The default identity prompt template
 */
export function resolveDefaultIdentitySystemPrompt(settings) {
  const custom = (
    settings && typeof settings.defaultIdentitySystemPrompt === "string"
      ? settings.defaultIdentitySystemPrompt
      : ""
  ).trim();
  return (custom || DEFAULT_COMBO_IDENTITY_PROMPT).trim();
}

/**
 * Resolve the per-combo identity system prompt. The resolved text is both what
 * gets injected into the upstream request and the needle stripped from responses.
 * Mode 'override' (legacy/default): custom text replaces the default template
 * (empty custom → default template). Mode 'append': custom text is injected
 * BEFORE the default template with a blank line between (empty custom → default
 * template only). "{name}" is substituted in both custom and default using the
 * combo name.
 * @param {object} combo - Full combo row (from getComboByName)
 * @param {string} [defaultPrompt] - Pre-substituted app-level default template;
 *   omitted/empty falls back to resolveDefaultIdentitySystemPrompt()
 * @returns {string|null} Prompt text, or null when off (toggle off / media combo)
 */
export function resolveComboSystemPrompt(combo, defaultPrompt) {
  if (!combo || !combo.systemPromptEnabled || combo.kind) return null;
  const name = combo.name || "";
  const custom = (typeof combo.systemPrompt === "string" ? combo.systemPrompt.trim() : "");
  const base = (typeof defaultPrompt === "string" && defaultPrompt.trim())
    ? defaultPrompt.trim()
    : resolveDefaultIdentitySystemPrompt();
  const mode = combo.systemPromptMode === "append" ? "append" : "override";

  if (mode === "append") {
    if (!custom) {
      const def = base.replaceAll("{name}", name).trim();
      return def || null;
    }
    const left = custom.replaceAll("{name}", name).trim();
    const right = base.replaceAll("{name}", name).trim();
    return [left, right].filter(Boolean).join("\n\n") || null;
  }

  // override — custom replaces the default template (empty custom → default)
  const template = custom || base;
  const prompt = template.replaceAll("{name}", name).trim();
  return prompt || null;
}

/**
 * Resolve the per-combo hidden-thinking usage-synthesis config (see
 * resolveThinkingSynthesis in open-sse/utils/stream.js for how it applies).
 * Returns null when nothing EXPLICIT is configured — a combo left at defaults
 * must not shadow a nested combo's explicit setting (outermost-explicit
 * wins, same rule as resolveComboSystemPrompt's nesting in chat.js) — or for
 * media combos.
 * @param {object} combo - Full combo row (from getComboByName)
 * @returns {{mode: "auto"|"off"|"always", minRatio: number|null, maxRatio: number|null}|null}
 */
export function resolveComboThinkingUsage(combo) {
  if (!combo || combo.kind) return null;
  const mode = (combo.thinkingUsageMode === "off" || combo.thinkingUsageMode === "always") ? combo.thinkingUsageMode : null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null);
  const minRatio = num(combo.thinkingUsageMinRatio);
  const maxRatio = num(combo.thinkingUsageMaxRatio);
  if (!mode && minRatio === null && maxRatio === null) return null;
  return { mode: mode || "auto", minRatio, maxRatio };
}
