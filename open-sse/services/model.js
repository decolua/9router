import REGISTRY from "../providers/registry/index.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
const MEDIA_ONLY_ALIASES = {
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly",
  // Free-tier providers (synced from OmniRoute)
  agentrouter: "agentrouter",
  aimlapi: "aimlapi",
  aiml: "aimlapi",
  novita: "novita",
  modal: "modal",
  mdl: "modal",
  reka: "reka",
  nlpcloud: "nlpcloud",
  nlpc: "nlpcloud",
  bazaarlink: "bazaarlink",
  bzl: "bazaarlink",
  completions: "completions",
  cpl: "completions",
  enally: "enally",
  enly: "enally",
  freetheai: "freetheai",
  fta: "freetheai",
  llm7: "llm7",
  lepton: "lepton",
  kluster: "kluster",
  ai21: "ai21",
  "inference-net": "inference-net",
  inet: "inference-net",
  predibase: "predibase",
  bytez: "bytez",
  morph: "morph",
  longcat: "longcat",
  lc: "longcat",
  puter: "puter",
  pu: "puter",
  uncloseai: "uncloseai",
  unc: "uncloseai",
  scaleway: "scaleway",
  scw: "scaleway",
  deepinfra: "deepinfra",
  sambanova: "sambanova",
  samba: "sambanova",
  nscale: "nscale",
  baseten: "baseten",
  publicai: "publicai",
  "nous-research": "nous-research",
  nous: "nous-research",
  glhf: "glhf",
  bb: "blackbox",
  blackbox: "blackbox",
  // RouterAI
  routerai: "routerai",
  rai: "routerai",
  rtr: "routerai",
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
  // Guard: modelStr must be a string
  if (typeof modelStr !== "string" || !modelStr) {
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
const MODEL_PREFIX_PROVIDERS = [
  [/^claude-/, "anthropic"],
  [/^gemini-/, "gemini"],
  [/^gpt-/, "openai"],
  [/^o[134]/, "openai"],
  [/^deepseek-/, "routerai"],
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
