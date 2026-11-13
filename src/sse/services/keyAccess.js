// Per-API-key access control for the /v1/* inference keys.
//
// Two modes per key: UNRESTRICTED (default — exactly today's behaviour) or
// RESTRICTED, where the key may call ONLY the combos and models in its allow
// list. Exact entries and patterns are matched case-insensitively on
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
import { resolveProviderId, getProviderAlias } from "@/shared/constants/providers.js";
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
export { extractClientApiKey } from "@/shared/utils/clientApiKey.js";
import { extractClientApiKey } from "@/shared/utils/clientApiKey.js";

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
    _sets: null,
  };
}

// Wildcard pattern entries (e.g. "oc/*", "*claude*", "*") match the model's
// canonical spelling and the provider alias spelling, so a pattern may be written
// with either the provider alias or the provider id. Non-wildcard entries
// are handled strictly by the canonical set checks below.
function matchesWildcardPattern(str, pattern) {
  if (!pattern || typeof pattern !== "string") return false;
  if (pattern.startsWith("/")) {
    const match = /^\/(.+)\/([a-z]*)$/i.exec(pattern);
    if (!match) return false;
    try { return new RegExp(match[1], match[2] || "i").test(str); } catch { return false; }
  }
  const p = pattern.trim().toLowerCase();
  if (!p.includes("*")) return false;
  if (p === "*") return true;
  const target = String(str || "").trim().toLowerCase();
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(target);
}

function anyWildcardMatches(canonical, requested, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const [provider, ...parts] = canonical.split("/");
  const model = parts.join("/");
  const targets = model ? [canonical, `${getProviderAlias(provider) || provider}/${model}`] : [canonical];
  for (const p of patterns) {
    if (targets.some((target) => matchesWildcardPattern(target, p))) return true;
    if (p.startsWith("/") && model && matchesWildcardPattern(model, p)) return true;
    // "alias/*" also covers the provider-id spelling (oc/* ≡ opencode/*)
    const m = /^([^/*]+)\/\*$/.exec(String(p || "").trim().toLowerCase());
    if (m) {
      const id = resolveProviderId(m[1]);
      if (id && canonical.startsWith(`${id}/`)) return true;
    }
  }
  return false;
}

// Deny entries ("!pattern" / "-pattern") reject the model outright, even when
// a positive rule would allow it. A bare deny term (no "*") also matches as a
// substring of either spelling, so "-haiku" needs no asterisks.
function isDeniedByRules(sets, requested, canonical) {
  for (const deny of sets.deny) {
    if (anyWildcardMatches(canonical, requested, [deny])) return true;
    if (deny.startsWith("/")) continue;
    const r = String(canonical || requested || "").toLowerCase();
    const nameOnly = r.includes("/") ? r.split("/").slice(1).join("/") : r;
    if (r.includes(deny.toLowerCase()) || nameOnly.includes(deny.toLowerCase())) return true;
  }
  return false;
}

// Resolve the allow list once per request: combo names, resolved model ids,
// and resolved provider ids (for provider-as-model kinds).
async function getAllowSets(ctx) {
  if (ctx._sets) return ctx._sets;
  const comboNames = new Set((await getCombos()).map((c) => lower(c.name)));
  const combos = new Set();
  const models = new Set();
  const providers = new Set();
  const deny = [];
  const patterns = [];
  const resolvePattern = async (pattern) => {
    if (!/^[^/*]+\/\*$/.test(pattern)) return pattern;
    const info = await getModelInfo(pattern);
    return info?.provider ? `${info.provider}/*` : pattern;
  };
  let positives = 0;
  for (const entry of ctx.allow) {
    const trimmed = String(entry ?? "").trim();
    if ((trimmed.startsWith("!") || trimmed.startsWith("-")) && trimmed.length > 1) {
      deny.push(await resolvePattern(trimmed.slice(1)));
      continue;
    }
    positives += 1;
    if (trimmed.includes("*") || trimmed.startsWith("/")) {
      patterns.push(await resolvePattern(trimmed));
      continue;
    }
    const key = lower(entry);
    if (comboNames.has(key)) {
      combos.add(key);
      continue;
    }
    const info = await getModelInfo(entry);
    if (info?.provider && info.model) models.add(canonicalModel(info.provider, info.model));
    if (!entry.includes("/")) providers.add(lower(resolveProviderId(entry)));
  }
  // A deny-only list (no positive entries) allows everything not denied;
  // an EMPTY list still denies everything.
  ctx._sets = { combos, models, providers, deny, patterns, openExceptDenied: deny.length > 0 && positives === 0 };
  return ctx._sets;
}

async function isModelStringAllowed(ctx, requested) {
  const sets = await getAllowSets(ctx);
  const info = await getModelInfo(requested);
  // provider null ⇔ an existing combo with no members (routes nowhere).
  if (!info?.provider) return sets.combos.has(lower(requested)) || sets.openExceptDenied;
  const canonical = canonicalModel(info.provider, info.model);
  if (isDeniedByRules(sets, requested, canonical)) return false;
  if (sets.openExceptDenied) return true;
  if (sets.models.has(canonical)) return true;
  return anyWildcardMatches(canonical, requested, sets.patterns);
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
  if (comboModels && isDeniedByRules(sets, requested, requested)) return keyAccessDeniedResponse(ctx, requested);
  const allowed = comboModels
    ? (sets.combos.has(lower(requested)) || sets.openExceptDenied)
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
  if (!ctx) return null;
  const label = requested || (provider ? `${provider}/${model ?? ""}` : "");
  if (!provider || !model) return keyAccessDeniedResponse(ctx, label);
  const sets = await getAllowSets(ctx);
  const canonical = canonicalModel(provider, model);
  if (isDeniedByRules(sets, label, canonical)) return keyAccessDeniedResponse(ctx, label);
  if (sets.models.has(canonical)) return null;
  if (anyWildcardMatches(canonical, label, sets.patterns)) return null;
  if (sets.openExceptDenied) return null;
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
  const provider = lower(resolveProviderId(requested));
  if (isDeniedByRules(sets, requested, provider)) return keyAccessDeniedResponse(ctx, requested);
  const allowed = comboModels
    ? (sets.combos.has(lower(requested)) || sets.openExceptDenied)
    : (sets.providers.has(provider) || sets.openExceptDenied || anyWildcardMatches(provider, requested, sets.patterns));
  return allowed ? null : keyAccessDeniedResponse(ctx, requested);
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
      if (!isDeniedByRules(sets, entry.id, entry.id) && (sets.combos.has(lower(entry.id)) || sets.openExceptDenied)) out.push(entry);
      continue;
    }
    const info = await getModelInfo(entry.id);
    if (!info?.provider) continue;
    if (KEY_ACCESS_PROVIDER_AS_MODEL_KINDS.includes(entry.kind)) {
      if (isDeniedByRules(sets, entry.id, lower(info.provider))) continue;
      if (sets.providers.has(lower(info.provider)) || sets.openExceptDenied || anyWildcardMatches(entry.id, entry.id, sets.patterns)) out.push(entry);
      continue;
    }
    const canonical = canonicalModel(info.provider, info.model);
    if (isDeniedByRules(sets, entry.id, canonical)) continue;
    if (sets.models.has(canonical) || sets.openExceptDenied || anyWildcardMatches(canonical, entry.id, sets.patterns)) out.push(entry);
  }
  return out;
}
