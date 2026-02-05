// Provider alias to ID mapping
const ALIAS_TO_PROVIDER_ID = {
  cc: "claude",
  cx: "codex",
  gc: "gemini-cli",
  qw: "qwen",
  if: "iflow",
  ag: "antigravity",
  gh: "github",
  kr: "kiro",
  cu: "cursor",
  // API Key providers (alias = id)
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  openrouter: "openrouter",
  cursor: "cursor",
};

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
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
  return { provider: null, model: modelStr, isAlias: true, providerAlias: null };
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
      model: resolved.slice(firstSlash + 1)
    };
  }
  
  // Or object { provider, model }
  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model
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
      model: parsed.model
    };
  }

  // Get aliases (from object or function)
  const aliases = typeof aliasesOrGetter === "function" 
    ? await aliasesOrGetter() 
    : aliasesOrGetter;

  // Resolve alias
  const resolved = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolved) {
    return resolved;
  }

  // Fallback: treat as openai model
  return {
    provider: "openai",
    model: parsed.model
  };
}

