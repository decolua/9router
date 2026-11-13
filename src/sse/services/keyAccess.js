// Per-API-key access control for the /v1/* inference keys.
//
// Two modes per key: UNRESTRICTED (default — exactly today's behaviour) or
// RESTRICTED, where the key may call ONLY the combos and models in its allow
// list. No wildcards, no deny mode. Matching is exact and case-insensitive, on
// RESOLVED identities, so every spelling that routes to the same target is
// treated the same and no spelling can route somewhere the list does not name:
//
//   * a request that routes as a combo (getComboModels — the lookup routing
//     itself uses) is allowed iff that combo's name is listed;
//   * a request that routes to a model is allowed iff its resolved
//     `providerId/model` equals the resolved `providerId/model` of a listed
//     model entry. So `cx/gpt-5`, `codex/gpt-5` and an alias that points there
//     are one target; a raw string that merely looks like a listed entry but
//     routes elsewhere (e.g. `MAIN` when the combo is `Main`, which routes to
//     `openai/MAIN`) is not;
//   * search/fetch (provider IS the model) are allowed iff the resolved
//     provider id is listed, or the request is a listed combo.
//
// An allowed combo grants its members when they are reached THROUGH that combo
// (the check runs once, on the requested target, before combo expansion). It
// does not grant calling a member directly by name — that needs its own entry.
// The check runs before any credential lookup, so a denied request never
// touches a provider account.
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getModelInfo, getComboModels } from "./model.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import {
  KEY_ACCESS_COMBO_OWNER,
  KEY_ACCESS_PROVIDER_AS_MODEL_KINDS,
  keyAccessDeniedMessage,
} from "@/shared/constants/keyAccess.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

const lower = (s) => String(s).toLowerCase();
const canonicalModel = (provider, model) => lower(`${provider}/${model}`);

/**
 * The client key, read from the same places and in the same order as the
 * middleware (src/dashboardGuard.js) reads the key it authorizes a remote
 * /v1 call with: Bearer, x-api-key, x-goog-api-key, ?key=. Handlers' own
 * extractApiKey() only reads the first two, so using it here would let a
 * restricted key sent as x-goog-api-key look like "no key" (= unrestricted).
 */
export function extractClientApiKey(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const xApiKey = headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  const googKey = headers.get("x-goog-api-key");
  if (googKey) return googKey;
  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return null;
  }
}

/**
 * Access context for the request's key, or null when the request is
 * unrestricted (no key, unknown key, or a key whose access is unrestricted).
 * Keys are only authenticated elsewhere (middleware / requireApiKey); this only
 * decides what an identified key may call.
 */
export async function getKeyAccessContext(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const record = await getApiKeyByKey(apiKey);
  if (!record?.access?.restricted) return null;
  return {
    keyId: record.id,
    keyName: record.name || record.id,
    allow: record.access.allow || [],
    allowedProviders: record.access.allowedProviders || [],
    allowedConnections: record.access.allowedConnections || [],
    _sets: null,
  };
}

// Resolve the allow list once per request: combo names, resolved model ids,
// and resolved provider ids (for provider-as-model kinds), plus allowed providers & connections.
async function getAllowSets(ctx) {
  if (ctx._sets) return ctx._sets;
  const comboNames = new Set((await getCombos()).map((c) => lower(c.name)));
  const combos = new Set();
  const models = new Set();
  const providers = new Set();

  for (const entry of ctx.allow || []) {
    const key = lower(entry);
    if (comboNames.has(key)) {
      combos.add(key);
      continue;
    }
    const info = await getModelInfo(entry);
    if (info?.provider && info.model) models.add(canonicalModel(info.provider, info.model));
    if (!entry.includes("/")) providers.add(lower(resolveProviderId(entry)));
  }

  const allowedProviders = new Set(
    (ctx.allowedProviders || []).map((p) => lower(resolveProviderId(p)))
  );

  // Group allowed connections by resolved provider
  const allowedConnectionsByProvider = new Map();
  if (Array.isArray(ctx.allowedConnections) && ctx.allowedConnections.length > 0) {
    try {
      const { getProviderConnectionsByIds } = await import("@/lib/db/repos/connectionsRepo.js");
      const connRows = await getProviderConnectionsByIds(ctx.allowedConnections);
      for (const row of connRows) {
        if (!row?.provider) continue;
        const p = lower(resolveProviderId(row.provider));
        if (!allowedConnectionsByProvider.has(p)) {
          allowedConnectionsByProvider.set(p, new Set());
        }
        allowedConnectionsByProvider.get(p).add(row.id);
      }
    } catch (e) {
      log.warn("AUTH", `Failed to load connection details for key access: ${e?.message || e}`);
    }
  }

  ctx._sets = {
    combos,
    models,
    providers,
    allowedProviders,
    allowedConnectionsByProvider,
  };
  return ctx._sets;
}

export async function isModelStringAllowed(ctx, requested) {
  if (!ctx) return true;
  const sets = await getAllowSets(ctx);
  const info = await getModelInfo(requested);

  // provider null <=> combo name or unresolvable
  if (!info?.provider) {
    if (sets.combos.has(lower(requested))) return true;
    const comboModels = await getComboModels(requested);
    if (comboModels && comboModels.length > 0) {
      for (const m of comboModels) {
        if (await isModelStringAllowed(ctx, m)) return true;
      }
    }
    return false;
  }

  const resolvedProvider = lower(resolveProviderId(info.provider));

  // 1. Check provider restrictions
  if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(resolvedProvider)) {
    return false;
  }

  // 2. Check connection restrictions: if connections are restricted for this provider, must have >=1
  if (sets.allowedConnectionsByProvider.has(resolvedProvider)) {
    const allowedConns = sets.allowedConnectionsByProvider.get(resolvedProvider);
    if (!allowedConns || allowedConns.size === 0) return false;
  }

  // 3. Model restrictions: if specific models/combos were listed in allow
  if (sets.models.size > 0 || sets.combos.size > 0) {
    return sets.models.has(canonicalModel(info.provider, info.model));
  }

  // If allow is empty, but allowedProviders or allowedConnections were set, all models under allowed provider are permitted
  if (sets.allowedProviders.size > 0 || ctx.allowedConnections?.length > 0) {
    return true;
  }

  // Fails closed if restricted but nothing allowed
  return false;
}

export function keyAccessDeniedResponse(ctx, requested) {
  log.warn("AUTH", `key-access: key "${ctx.keyName}" denied "${requested}"`);
  return errorResponse(HTTP_STATUS.FORBIDDEN, keyAccessDeniedMessage(requested));
}

/**
 * Gate for endpoints whose `model` may be a combo or a model (chat, image, tts).
 * Call with the requested string BEFORE combo expansion.
 * @returns {Promise<Response|null>} a 403 Response, or null when allowed.
 */
export async function enforceKeyAccess(ctx, requested) {
  if (!ctx) return null;
  if (typeof requested !== "string" || !requested) return keyAccessDeniedResponse(ctx, String(requested ?? ""));
  const sets = await getAllowSets(ctx);
  const comboModels = await getComboModels(requested);
  let allowed = false;
  if (comboModels) {
    if (sets.combos.has(lower(requested))) {
      allowed = true;
    } else {
      // Dynamic combo check: allowed if any member model is permitted
      for (const m of comboModels) {
        if (await isModelStringAllowed(ctx, m)) {
          allowed = true;
          break;
        }
      }
    }
  } else {
    allowed = await isModelStringAllowed(ctx, requested);
  }
  return allowed ? null : keyAccessDeniedResponse(ctx, requested);
}

/**
 * Gate for endpoints that resolve a single provider/model themselves
 * (embeddings, stt, systemone, video, Gemini-native TTS). A missing model
 * (e.g. a multipart video body we do not parse) is denied for restricted keys:
 * an unverifiable target is not an allowed one.
 */
export async function enforceKeyAccessResolved(ctx, requested, provider, model) {
  if (!ctx) return null;
  const label = requested || (provider ? `${provider}/${model ?? ""}` : "");
  if (!provider || !model) return keyAccessDeniedResponse(ctx, label);
  const sets = await getAllowSets(ctx);
  const resolvedProvider = lower(resolveProviderId(provider));

  if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(resolvedProvider)) {
    return keyAccessDeniedResponse(ctx, label);
  }

  if (sets.allowedConnectionsByProvider.has(resolvedProvider)) {
    const allowedConns = sets.allowedConnectionsByProvider.get(resolvedProvider);
    if (!allowedConns || allowedConns.size === 0) return keyAccessDeniedResponse(ctx, label);
  }

  if (sets.models.size > 0 || sets.combos.size > 0) {
    return sets.models.has(canonicalModel(provider, model)) ? null : keyAccessDeniedResponse(ctx, label);
  }

  if (sets.allowedProviders.size > 0 || ctx.allowedConnections?.length > 0) {
    return null;
  }

  return keyAccessDeniedResponse(ctx, label);
}

/**
 * Gate for search/fetch, where the provider IS the model.
 * @param {string[]|null} comboModels - routing's own combo resolution for `requested`
 */
export async function enforceKeyAccessProvider(ctx, requested, comboModels) {
  if (!ctx) return null;
  if (typeof requested !== "string" || !requested) return keyAccessDeniedResponse(ctx, String(requested ?? ""));
  const sets = await getAllowSets(ctx);
  if (comboModels) {
    if (sets.combos.has(lower(requested))) return null;
    for (const m of comboModels) {
      if (await isModelStringAllowed(ctx, m)) return null;
    }
    return keyAccessDeniedResponse(ctx, requested);
  }

  const resolved = lower(resolveProviderId(requested));
  if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(resolved)) {
    return keyAccessDeniedResponse(ctx, requested);
  }

  if (sets.providers.size > 0) {
    return sets.providers.has(resolved) ? null : keyAccessDeniedResponse(ctx, requested);
  }

  if (sets.allowedProviders.size > 0) {
    return null;
  }

  return keyAccessDeniedResponse(ctx, requested);
}

/**
 * Prunes a combo's model list, keeping only models that the key has access to (Rule #3 Opsi A).
 * If comboName is explicitly in the key's allowed combos list, its members are granted through the combo
 * (subject to any allowedProviders / allowedConnections restrictions).
 * @param {object|null} ctx
 * @param {string[]} comboModels
 * @param {string|null} comboName
 * @returns {Promise<string[]>}
 */
export async function pruneComboModelsForKey(ctx, comboModels, comboName = null) {
  if (!ctx || !Array.isArray(comboModels)) return comboModels;
  const sets = await getAllowSets(ctx);
  const isAllowedCombo = comboName && sets.combos.has(lower(comboName));

  const out = [];
  for (const m of comboModels) {
    if (isAllowedCombo) {
      // Member is reached through an explicitly allowed combo.
      // Combo grants its members, but provider/connection restrictions still apply!
      const info = await getModelInfo(m);
      if (info?.provider) {
        const resolvedProvider = lower(resolveProviderId(info.provider));
        if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(resolvedProvider)) {
          log.info("AUTH", `key-access: key "${ctx.keyName}" pruned combo member "${m}" (provider "${resolvedProvider}" not allowed)`);
          continue;
        }
        if (sets.allowedConnectionsByProvider.has(resolvedProvider)) {
          const allowedConns = sets.allowedConnectionsByProvider.get(resolvedProvider);
          if (!allowedConns || allowedConns.size === 0) {
            log.info("AUTH", `key-access: key "${ctx.keyName}" pruned combo member "${m}" (no allowed connections)`);
            continue;
          }
        }
      }
      out.push(m);
    } else {
      if (await isModelStringAllowed(ctx, m)) {
        out.push(m);
      } else {
        log.info("AUTH", `key-access: key "${ctx.keyName}" pruned combo member "${m}" (no access)`);
      }
    }
  }
  return out;
}

/**
 * Resolves allowed connection IDs for a specific provider.
 * Returns:
 * - null: all active accounts of this provider are permitted (unrestricted).
 * - Set<string>: only connection IDs in this set are permitted.
 * - empty Set: this provider is forbidden for this key.
 */
export async function getAllowedConnectionIdsForProvider(ctx, provider) {
  if (!ctx) return null;
  const sets = await getAllowSets(ctx);
  const resolvedProvider = lower(resolveProviderId(provider));

  // Check provider allowlist
  if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(resolvedProvider)) {
    return new Set(); // 0 allowed
  }

  // Check connection allowlist:
  // If specific connections for this provider were listed in allowedConnections
  if (sets.allowedConnectionsByProvider.has(resolvedProvider)) {
    return sets.allowedConnectionsByProvider.get(resolvedProvider);
  }

  // Hierarchical (Rule #2 Opsi A): If provider is allowed and NO specific accounts were selected
  // for this provider, then all active accounts of this provider are allowed!
  return null;
}

/**
 * Capacity-adapter models are appended by the gateway, not chosen by the
 * client. For a restricted key keep only the adapter models the key may call
 * directly; the original targets (already gated) are always kept. Dropping a
 * model just shortens the fallback list, so combo failover is unaffected.
 */
export async function filterAdapterModels(ctx, augmented, original) {
  if (!ctx || !Array.isArray(augmented)) return augmented;
  const keep = new Set(original || []);
  const out = [];
  for (const m of augmented) {
    if (keep.has(m) || await isModelStringAllowed(ctx, m)) out.push(m);
    else log.info("AUTH", `key-access: key "${ctx.keyName}" skips adapter model "${m}" (not allowed)`);
  }
  return out;
}

/** /v1/models: a restricted key sees only the combos and models it may call. */
export async function filterModelsListForKey(ctx, list) {
  if (!ctx || !Array.isArray(list)) return list;
  const sets = await getAllowSets(ctx);
  const out = [];
  for (const entry of list) {
    if (!entry?.id) continue;
    if (entry.owned_by === KEY_ACCESS_COMBO_OWNER) {
      if (sets.combos.has(lower(entry.id))) {
        out.push(entry);
        continue;
      }
      const comboModels = await getComboModels(entry.id);
      if (comboModels && comboModels.length > 0) {
        let hasAllowed = false;
        for (const m of comboModels) {
          if (await isModelStringAllowed(ctx, m)) { hasAllowed = true; break; }
        }
        if (hasAllowed) out.push(entry);
      }
      continue;
    }
    const info = await getModelInfo(entry.id);
    if (!info?.provider) continue;
    if (KEY_ACCESS_PROVIDER_AS_MODEL_KINDS.includes(entry.kind)) {
      if (sets.allowedProviders.size > 0 && !sets.allowedProviders.has(lower(resolveProviderId(info.provider)))) continue;
      if (sets.providers.has(lower(info.provider)) || (sets.allowedProviders.size > 0 && sets.models.size === 0)) out.push(entry);
      continue;
    }
    if (await isModelStringAllowed(ctx, entry.id)) out.push(entry);
  }
  return out;
}
