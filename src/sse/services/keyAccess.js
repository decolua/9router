// Per-API-key access control for the /v1/* inference keys.
//
// Two modes per key: UNRESTRICTED (default — exactly today's behaviour) or
// RESTRICTED, where the key may call ONLY the combos and models in its allow
// list. Provider and model-segment wildcards are supported, but no deny mode.
// Matching is case-insensitive, on
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
import { randomUUID } from "node:crypto";
import { getApiKeyByKey, touchApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getModelInfo, getComboModels } from "./model.js";
import { resolveProviderId } from "@/shared/constants/providers.js";
import { matchesWildcardPattern } from "@/shared/utils/modelPermissions.js";
import {
  KEY_ACCESS_COMBO_OWNER,
  KEY_ACCESS_PROVIDER_AS_MODEL_KINDS,
  keyAccessDeniedMessage,
} from "@/shared/constants/keyAccess.js";
import { errorResponse } from "open-sse/utils/error.js";
import { getDailyUsageForApiKey } from "@/lib/db/repos/usageRepo";
import { saveRequestUsage } from "@/lib/usageDb.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

const lower = (s) => String(s).toLowerCase();
const canonicalModel = (provider, model) => lower(`${resolveProviderId(lower(provider))}/${model}`);

function matchesModelPattern(pattern, identity) {
  const value = lower(pattern);
  const target = lower(identity);
  if (value.endsWith("/*") && !value.slice(0, -2).includes("*")) {
    return target.startsWith(value.slice(0, -1)) && target.length > value.length - 1;
  }
  if (value.includes("/")) return matchesWildcardPattern(value, target);
  return matchesWildcardPattern(value, target.slice(target.indexOf("/") + 1));
}

async function resolvePattern(entry) {
  if (!entry.includes("/")) return entry;
  const slash = entry.indexOf("/");
  const prefix = entry.slice(0, slash);
  const suffix = entry.slice(slash + 1);
  const info = await getModelInfo(`${lower(prefix)}/__key_access_pattern__`);
  return `${info?.provider || resolveProviderId(lower(prefix))}/${suffix}`;
}

function isAllowedModel(sets, provider, model) {
  const identity = canonicalModel(provider, model);
  return sets.models.has(identity) || sets.patterns.some((pattern) => matchesModelPattern(pattern, identity));
}

export async function enforceKeyPolicy(ctx) {
  if (!ctx) return null;
  if (ctx.expiresAt && new Date(ctx.expiresAt).getTime() <= Date.now()) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key has expired");
  }
  if (ctx.maxRequestsPerDay != null || ctx.maxSpendUsdPerDay != null) {
    let usage;
    try {
      usage = await getDailyUsageForApiKey(ctx.apiKey);
    } catch (error) {
      log.error("AUTH", `Failed to check daily key usage: ${error.message}`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Unable to verify API key usage limit");
    }
    if (ctx.maxRequestsPerDay != null && usage.requests >= ctx.maxRequestsPerDay) {
      return errorResponse(HTTP_STATUS.RATE_LIMITED, `Daily request limit reached (${usage.requests}/${ctx.maxRequestsPerDay})`);
    }
    if (ctx.maxSpendUsdPerDay != null && usage.cost >= ctx.maxSpendUsdPerDay) {
      return errorResponse(HTTP_STATUS.RATE_LIMITED, `Daily spend limit reached ($${usage.cost.toFixed(4)}/$${ctx.maxSpendUsdPerDay})`);
    }
  }
  return null;
}

export async function evaluateKeyPolicy(ctx, requested, target = {}) {
  const policyError = await enforceKeyPolicy(ctx);
  if (policyError) return policyError;
  const accessError = target.kind === "resolved"
    ? await enforceKeyAccessResolved(ctx, requested, target.provider, target.model)
    : target.kind === "provider"
      ? await enforceKeyAccessProvider(ctx, requested, target.comboModels)
      : await enforceKeyAccess(ctx, requested);
  if (accessError) return accessError;
  if (ctx) touchApiKey(ctx.apiKey).catch((err) => log.warn("AUTH", `Failed to touch api key: ${err.message}`));
  return null;
}

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
 * Access context for a known key, including unrestricted keys; null when no
 * known key is presented. Authentication remains the middleware's responsibility.
 */
const requestContexts = new WeakMap();
const requestIds = new WeakMap();

export function getUsageRequestId(request) {
  if (!requestIds.has(request)) requestIds.set(request, randomUUID());
  return requestIds.get(request);
}

export async function recordKeyedUsage(request, ctx, entry) {
  if (!ctx?.apiKey) return null;
  try {
    await saveRequestUsage({ ...entry, apiKey: ctx.apiKey, requestId: getUsageRequestId(request), status: "success" });
    return null;
  } catch (error) {
    log.error("AUTH", `Failed to record API key usage: ${error.message}`);
    return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Unable to record API key usage");
  }
}

export async function getKeyAccessContext(request) {
  if (requestContexts.has(request)) return requestContexts.get(request);
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const record = await getApiKeyByKey(apiKey);
  if (!record) return null;
  const ctx = {
    keyId: record.id,
    keyName: record.name || record.id,
    apiKey,
    restricted: record.access?.restricted === true,
    allow: record.access?.allow || [],
    expiresAt: record.expiresAt,
    maxRequestsPerDay: record.maxRequestsPerDay,
    maxSpendUsdPerDay: record.maxSpendUsdPerDay,
    _sets: null,
  };
  requestContexts.set(request, ctx);
  return ctx;
}

// Resolve the allow list once per request: combo names, resolved model ids,
// and resolved provider ids (for provider-as-model kinds).
async function getAllowSets(ctx) {
  if (ctx._sets) return ctx._sets;
  const comboNames = new Set((await getCombos()).map((c) => lower(c.name)));
  const combos = new Set();
  const models = new Set();
  const providers = new Set();
  const patterns = [];
  for (const entry of ctx.allow) {
    if (entry.includes("*")) {
      patterns.push(await resolvePattern(entry));
      continue;
    }
    const key = lower(entry);
    if (comboNames.has(key)) {
      combos.add(key);
      continue;
    }
    const slash = entry.indexOf("/");
    const resolvedEntry = slash >= 0 ? `${lower(entry.slice(0, slash))}${entry.slice(slash)}` : entry;
    const info = await getModelInfo(resolvedEntry);
    if (info?.provider && info.model) models.add(canonicalModel(info.provider, info.model));
    if (slash < 0) providers.add(lower(resolveProviderId(lower(entry))));
  }
  ctx._sets = { combos, models, providers, patterns };
  return ctx._sets;
}

async function isModelStringAllowed(ctx, requested) {
  const sets = await getAllowSets(ctx);
  const info = await getModelInfo(requested);
  // provider null ⇔ an existing combo with no members (routes nowhere).
  if (!info?.provider) return sets.combos.has(lower(requested));
  return isAllowedModel(sets, info.provider, info.model);
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
  if (!ctx?.restricted) return null;
  if (typeof requested !== "string" || !requested) return keyAccessDeniedResponse(ctx, String(requested ?? ""));
  const sets = await getAllowSets(ctx);
  const comboModels = await getComboModels(requested);
  const allowed = comboModels
    ? sets.combos.has(lower(requested))
    : await isModelStringAllowed(ctx, requested);
  return allowed ? null : keyAccessDeniedResponse(ctx, requested);
}

/**
 * Gate for endpoints that resolve a single provider/model themselves
 * (embeddings, stt, systemone, video, Gemini-native TTS). A missing model
 * (e.g. a multipart video body we do not parse) is denied for restricted keys:
 * an unverifiable target is not an allowed one.
 */
export async function enforceKeyAccessResolved(ctx, requested, provider, model) {
  if (!ctx?.restricted) return null;
  const label = requested || (provider ? `${provider}/${model ?? ""}` : "");
  if (!provider || !model) return keyAccessDeniedResponse(ctx, label);
  const sets = await getAllowSets(ctx);
  return isAllowedModel(sets, provider, model) ? null : keyAccessDeniedResponse(ctx, label);
}

/**
 * Gate for search/fetch, where the provider IS the model.
 * @param {string[]|null} comboModels - routing's own combo resolution for `requested`
 */
export async function enforceKeyAccessProvider(ctx, requested, comboModels) {
  if (!ctx?.restricted) return null;
  if (typeof requested !== "string" || !requested) return keyAccessDeniedResponse(ctx, String(requested ?? ""));
  const sets = await getAllowSets(ctx);
  const provider = lower(resolveProviderId(lower(requested)));
  const allowed = comboModels
    ? sets.combos.has(lower(requested))
    : sets.providers.has(provider) || sets.patterns.some((pattern) => lower(pattern) === `${provider}/*`);
  return allowed ? null : keyAccessDeniedResponse(ctx, requested);
}

/**
 * Capacity-adapter models are appended by the gateway, not chosen by the
 * client. For a restricted key keep only the adapter models the key may call
 * directly; the original targets (already gated) are always kept. Dropping a
 * model just shortens the fallback list, so combo failover is unaffected.
 */
export async function filterAdapterModels(ctx, augmented, original) {
  if (!ctx?.restricted || !Array.isArray(augmented)) return augmented;
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
  if (!ctx?.restricted || !Array.isArray(list)) return list;
  const sets = await getAllowSets(ctx);
  const out = [];
  for (const entry of list) {
    if (!entry?.id) continue;
    if (entry.owned_by === KEY_ACCESS_COMBO_OWNER) {
      if (sets.combos.has(lower(entry.id))) out.push(entry);
      continue;
    }
    const info = await getModelInfo(entry.id);
    if (!info?.provider) continue;
    if (KEY_ACCESS_PROVIDER_AS_MODEL_KINDS.includes(entry.kind)) {
      if (sets.providers.has(lower(info.provider)) || sets.patterns.some((pattern) => lower(pattern) === `${lower(info.provider)}/*`)) out.push(entry);
      continue;
    }
    if (isAllowedModel(sets, info.provider, info.model)) out.push(entry);
  }
  return out;
}
