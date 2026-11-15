import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, modelSupportedFormats, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX, isMuseSparkModel, opencodeFamilyFormats } from "../providers/models/helpers.js";
import { FORMATS } from "../translator/formats.js";
export { PROVIDER_MODELS };

// OpenCode providers sharing the endpoint-family fallback for unknown model ids
const isOpenCodeAlias = (aliasOrId) => !aliasOrId || ["oc", "opencode", "ocg", "opencode-go", "ocz", "opencode-zen"].includes(aliasOrId);


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

// Providers whose registry uses dots in version numbers (e.g. "claude-sonnet-4.5").
// For these, we tolerate clients sending dashes ("claude-sonnet-4-5") by normalizing
// digit-hyphen-digit to digit-dot-digit before lookup. Other providers are left untouched.
const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

// Find a registry entry by id. For Kiro models, tolerates dash/dot version separators
// ("claude-sonnet-4-5" ~= "claude-sonnet-4.5"). Other providers use exact match only.
function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const baseModelId = typeof modelId === "string"
    ? modelId.replace(/\([^()]+\)\s*$/, "").trim()
    : modelId;
  const found = models.find(m => m.id === modelId || m.id === baseModelId);
  if (found) return found;
  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalized = normalizeModelId(baseModelId);
  if (normalized === baseModelId) return undefined;
  return models.find(m => m.id === normalized);
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return !!findModel(models, modelId, aliasOrId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  if (isOpenCodeAlias(aliasOrId) && isMuseSparkModel(modelId)) {
    return FORMATS.OPENAI_RESPONSES;
  }
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  if (found) return modelTargetFormat(found);
  // Family fallback keeps modelsFetcher/passthrough ids on their endpoint lane
  if (isOpenCodeAlias(aliasOrId)) return opencodeFamilyFormats(modelId)?.targetFormat || null;
  return null;
}

// Declared upstream formats for a model (registry `supportedFormats`). Drives the
// per-model guard on the sourceFormat-matched transport; null when undeclared.
// Unknown OpenCode ids fall back to the family regex (chat lane by default) so
// auto-fetched models never wrongly use the sourceFormat-matched transport.
export function getModelSupportedFormats(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  if (found) return modelSupportedFormats(found);
  if (isOpenCodeAlias(aliasOrId)) return opencodeFamilyFormats(modelId)?.supportedFormats || [FORMATS.OPENAI];
  return null;
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}

// Raw registry entry for a model (suffix-aware) — executor lookups of per-model hints (e.g. defaultLocation).
export function getModelMeta(aliasOrId, modelId) {
  return findModel(PROVIDER_MODELS[aliasOrId], modelId, aliasOrId) || null;
}

// Requested level → tier suffixes to try, most specific first; the last one is the
// collapsed tier every tiered family has. A promoted tier (xhigh) is only honored on
// a tier-preset entry whose upstreamModelId carries the same "(level)" — e.g. ag
// gemini-4-hydrogen-xhigh — so standalone ids such as ws/gpt-5.4-xhigh never get
// picked up by a reasoning_effort sent for gpt-5.4.
const TIER_FALLBACKS = { xhigh: ["xhigh", "high"], max: ["xhigh", "high"], minimal: ["low"] };

function findTierEntry(models, baseId, level, aliasOrId) {
  const tiers = TIER_FALLBACKS[level] || [level];
  for (const [i, tier] of tiers.entries()) {
    const entry = findModel(models, `${baseId}-${tier}`, aliasOrId);
    if (!entry) continue;
    const isPromoted = i < tiers.length - 1;
    if (isPromoted && !String(entry.upstreamModelId || "").endsWith(`(${tier})`)) continue;
    return { entry, tier };
  }
  return null;
}

export function getModelUpstreamId(aliasOrId, modelId, clientBody = null) {
  // Split off thinking suffix "(level)" so lookup hits the base id; re-append it to
  // the result so downstream applyThinking still sees the suffix (body.model is stripped separately).
  const sufMatch = typeof modelId === "string" ? modelId.match(/\([^()]+\)\s*$/) : null;
  const suffix = sufMatch ? sufMatch[0] : "";
  const baseId = suffix ? modelId.slice(0, sufMatch.index).trim() : modelId;
  const models = PROVIDER_MODELS[aliasOrId];

  // Resolve requested thinking level from suffix or client request body
  let level = suffix ? suffix.slice(1, -1).trim().toLowerCase() : "";
  if (!level && clientBody && typeof clientBody === "object") {
    const rawEffort = clientBody.reasoning_effort || clientBody.output_config?.effort || (typeof clientBody.reasoning === "object" ? clientBody.reasoning?.effort : null);
    if (typeof rawEffort === "string" && rawEffort) {
      level = rawEffort.toLowerCase().trim();
    } else if (clientBody.thinking && typeof clientBody.thinking === "object") {
      const b = Number(clientBody.thinking.budget_tokens);
      if (Number.isFinite(b) && b > 0) {
        level = b > 16384 ? "high" : b <= 4096 ? "low" : "medium";
      }
    }
  }

  // Look for tiered variant first if a tier was requested (e.g. gemini-3.8-flash-high)
  const tierHit = level ? findTierEntry(models, baseId, level, aliasOrId) : null;
  const tier = tierHit?.tier || (TIER_FALLBACKS[level]?.at(-1) ?? level);
  const found = tierHit?.entry || findModel(models, baseId, aliasOrId);
  const resolvedId = found?.upstreamModelId || found?.id;
  if (resolvedId) {
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    const resolvedBase = presetSuffix ? resolvedId.slice(0, presetMatch.index).trim() : resolvedId;
    return resolvedBase + (suffix || (presetSuffix && tier ? `(${tier})` : presetSuffix));
  }
  if (aliasOrId === "cx" && typeof baseId === "string" && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length) + suffix;
  }
  return baseId + suffix;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from REGISTRY — no need to maintain manually. REGISTRY (not PROVIDERS):
// media-only entries (elevenlabs, cartesia, inworld, ...) declare no transport, so
// keying off PROVIDERS dropped their alias and made their registry `models`
// unreachable — the exact same map PROVIDER_MODELS is keyed by
// (`entry.alias || entry.id` in providers/index.js).
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  REGISTRY.map(r => [r.id, r.alias || r.id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}
