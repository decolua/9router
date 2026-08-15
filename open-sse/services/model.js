import REGISTRY from "../providers/registry/index.js";
import { PROVIDER_MODELS } from "../config/providerModels.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
const MEDIA_ONLY_ALIASES = {
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly",
};

const ALIAS_TO_PROVIDER_ID = { ...MEDIA_ONLY_ALIASES };
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

const BUILTIN_MODEL_ALIASES = {
  "grok-build": "gcli/grok-build",
};

// Connection-less catalog providers (noAuth + live modelsFetcher) strip their
// provider prefix upstream and echo the bare id back. The listing emits their
// models as `${alias}/${id}`, so the response echo must use the same form for
// clients that validate the echo against /v1/models.
const CONNECTIONLESS_CATALOG_ALIASES = new Map();
for (const entry of REGISTRY) {
  if (entry.noAuth && entry.modelsFetcher && entry.alias) {
    CONNECTIONLESS_CATALOG_ALIASES.set(entry.id, entry.alias);
  }
}

/**
 * Model name a response should echo back to the client. Prefixed requests keep
 * their exact form (already listing-valid). Bare requests that resolved to a
 * connection-less catalog provider get the listing form re-injected — e.g.
 * bare "big-pickle" → "oc/big-pickle" — so re-sending the echoed name routes
 * again and passes listing validation instead of triggering client warnings.
 */
export function canonicalEchoModel({ requestedModel, provider, model }) {
  if (!requestedModel || requestedModel.includes("/")) return requestedModel;
  const alias = CONNECTIONLESS_CATALOG_ALIASES.get(provider);
  if (alias) return `${alias}/${model}`;
  return requestedModel;
}

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

/**
 * Deterministic owner for a bare model name from the static registry catalog.
 * Returns the provider ID that declares `modelStr`, or null when no static
 * provider declares it. Collisions (glm-5.2 is declared by glm, opencode-go,
 * qianfan, etc.) resolve to the provider whose id/alias is a name prefix of
 * the model (glm-5.2 → glm); when no prefix matches, no owner is returned so
 * callers can apply their own fallback.
 */
export function resolveBareModelStaticOwner(modelStr) {
  if (!modelStr) return null;
  const owners = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if (Array.isArray(models) && models.some((m) => m && m.id === modelStr)) {
      owners.push(alias);
    }
  }
  if (owners.length === 0) return null;
  if (owners.length === 1) return resolveProviderAlias(owners[0]);
  const byPrefix = owners.find((alias) => modelStr.startsWith(alias));
  if (byPrefix) return resolveProviderAlias(byPrefix);
  return null;
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  // Check if standard format: provider/model or alias/model
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  // Check if alias exists
  const resolved = aliases[alias];
  if (!resolved) return null;

  // Resolved value is "provider/model" format
  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  // Or object { provider, model }
  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - Model string
 * @param {object|function} aliasesOrGetter - Aliases object or async function to get aliases
 */
export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  // Get aliases (from object or function)
  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  // Resolve alias
  const resolved =
    resolveModelAliasFromMap(parsed.model, aliases) ||
    resolveModelAliasFromMap(parsed.model, BUILTIN_MODEL_ALIASES);
  if (resolved) {
    return resolved;
  }

  // Fallback: infer provider from model name prefix
  return {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
}

// Config-driven prefix → provider inference (first match wins, fallback "openai").
// NOTE: this only fires for bare names that survive the full resolution chain in
// src/sse/services/model.js (resolveBareModelToProvider) — custom models, user
// aliases, static registry declarations, and the live opencode catalog all win
// first. Names that genuinely belong to openrouter hit the deepseek rule here.
const MODEL_PREFIX_PROVIDERS = [
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "openrouter"],
];

/**
 * Infer provider from model name prefix
 * Used as fallback when no provider prefix or alias is given
 */
function inferProviderFromModelName(modelName) {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  return MODEL_PREFIX_PROVIDERS.find(([re]) => re.test(m))?.[1] || "openai";
}
