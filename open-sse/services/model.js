import { parseModelReference } from "../utils/modelReference.js";
import REGISTRY from "../providers/registry/index.js";

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

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 * Also extracts optional connection affinity suffix "@connectionId"
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  const { model: cleanStr, connectionId } = parseModelReference(modelStr);

  // Check if standard format: provider/model or alias/model
  if (cleanStr.includes("/")) {
    const firstSlash = cleanStr.indexOf("/");
    const providerOrAlias = cleanStr.slice(0, firstSlash);
    const model = cleanStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    const out = { provider, model, isAlias: false, providerAlias: providerOrAlias };
    if (connectionId) out.connectionId = connectionId;
    return out;
  }

  // Alias format (model alias, not provider alias)
  const out = {
    provider: null,
    model: cleanStr,
    isAlias: true,
    providerAlias: null,
  };
  if (connectionId) out.connectionId = connectionId;
  return out;
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
    const parsed = parseModel(resolved);
    return { provider: parsed.provider, model: parsed.model, ...(parsed.connectionId ? { connectionId: parsed.connectionId } : {}) };
  }

  // Or object { provider, model }
  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    const parsed = parseModelReference(resolved.model);
    const connectionId = resolved.connectionId || parsed.connectionId;
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: parsed.model,
      ...(connectionId ? { connectionId } : {}),
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
    const res = {
      provider: parsed.provider,
      model: parsed.model,
    };
    if (parsed.connectionId) res.connectionId = parsed.connectionId;
    return res;
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
    const res = { ...resolved };
    const connId = parsed.connectionId || resolved.connectionId;
    if (connId) res.connectionId = connId;
    return res;
  }

  // Fallback: infer provider from model name prefix
  const res = {
    provider: inferProviderFromModelName(parsed.model),
    model: parsed.model,
  };
  if (parsed.connectionId) res.connectionId = parsed.connectionId;
  return res;
}

// Config-driven prefix → provider inference (first match wins, fallback "openai").
const MODEL_PREFIX_PROVIDERS = [
  // Codex CLI sends this bare virtual model for auto-review - keep it on OAuth Codex (#1398).
  [/^codex-auto-review$/, "codex"],
  // Codex-only GPT model slugs: present in backend-api/codex/models but not on the
  // OpenAI API.  Without these rules a bare model id (e.g. "gpt-5.6-terra" from the
  // Codex CLI /model picker) resolves to provider "openai", which 404s for users that
  // only have a Codex OAuth account and no OpenAI API key (#4405).
  // Ranges covered: gpt-5.x, gpt-6.x, gpt-daybreak-*, gpt-reserve* — all are
  // Codex-backend models.  Plain "gpt-4*" / "gpt-3.5*" / "gpt-4o*" fall through to
  // the generic gpt-* → openai rule below.
  [/^gpt-[56]\./, "codex"],
  [/^gpt-6-/, "codex"],
  [/^gpt-daybreak-/, "codex"],
  [/^gpt-reserve/, "codex"],
  [/^claude-/, "anthropic"],
  // Bedrock inference profile IDs: us.anthropic.*, global.anthropic.*, eu.anthropic.*, etc.
  // Claude Code stores the Bedrock model ID directly (e.g. us.anthropic.claude-sonnet-4-6),
  // so bare usage without a provider/ prefix must route to bedrock, not fall through to openai.
  [/^(us|eu|ap|global)\.(anthropic|meta|amazon|mistral|xai)\./, "bedrock"],
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
