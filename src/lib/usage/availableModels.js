// Available-model list builder for the usage page, kept free of imports that
// touch the database so the self-check can load it directly. The catalog entry
// shape mirrors what GET /api/models returns: { provider, model, name,
// fullModel, routedModel, origin } where origin is one of "provider",
// "custom", "studio" or "combo".
import { parseAllowedModels, matchesAllowedModels } from "../db/repos/allowedModels.js";
import { isReservedProviderPrefix } from "../../shared/utils/providerPrefix.js";

/**
 * Every id spelling one catalog entry may be called by. The request gate and
 * the /v1/models listing both match the key's patterns against the model id
 * the client actually sends, which is usually `provider/model` or a bare combo
 * or studio name, so an entry is shown when ANY of its spellings matches.
 *
 * `entry.name` is deliberately NOT a candidate: it is a display label, never a
 * call path. A provider row named "DeepSeek-V4-Pro" but addressed as
 * `qd/dmodel` was showing up under a key scoped to `deepseek-v4-pro` - the
 * label matched, the id never did, and the request gate would have refused the
 * call. Only ids the client can actually send are admitted.
 */
export function createCustomProviderModelEntry({ provider, model, providerNode, aliases = {} } = {}) {
  const providerId = String(provider || "").trim();
  const modelInfo = typeof model === "string" ? { id: model } : (model || {});
  const modelId = String(modelInfo.id || modelInfo.model || modelInfo.name || "").trim();
  if (!providerId || !modelId) return null;

  const prefix = String(providerNode?.prefix || "").trim();
  const routedProvider = prefix && !isReservedProviderPrefix(prefix) ? prefix : providerId;
  const fullModel = `${providerId}/${modelId}`;
  const storedFullModel = modelInfo.providerAlias ? `${modelInfo.providerAlias}/${modelId}` : fullModel;
  return {
    name: modelInfo.display_name || modelInfo.displayName || modelInfo.name || modelId,
    model: modelId,
    provider: providerId,
    fullModel,
    routedModel: `${routedProvider}/${modelId}`,
    alias: aliases[fullModel] || aliases[storedFullModel] || modelId,
    origin: "custom",
  };
}

export function modelMatchCandidates(entry) {
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(entry.routedModel);
  push(entry.fullModel);
  push(entry.model);
  // A `provider/*` pattern admits every model served under that provider, the
  // same way the key-creation clamp reads it.
  if (entry.provider) push(`${entry.provider}/*`);
  return out;
}

/**
 * Narrow a model catalog to what one key's allowedModels admits. "*" (or an
 * empty value) keeps everything; anything else keeps only entries with at
 * least one candidate id the patterns admit. Pure: no I/O, no session.
 */
export function filterModelsByAllowedModels(models, allowedModels) {
  const list = Array.isArray(models) ? models : [];
  const patterns = parseAllowedModels(allowedModels);
  if (!patterns) return [...list];
  return list.filter((entry) => {
    if (!entry) return false;
    return modelMatchCandidates(entry).some((id) => matchesAllowedModels(patterns, id));
  });
}

/** Which spelling of this row the key's patterns admit, best first. */
function admittedId(entry, patterns) {
  const bare = String(entry.model || "").trim();
  if (bare && matchesAllowedModels(patterns, bare)) return bare;
  const routed = String(entry.routedModel || "").trim();
  if (routed && matchesAllowedModels(patterns, routed)) return routed;
  const full = String(entry.fullModel || "").trim();
  if (full && matchesAllowedModels(patterns, full)) return full;
  if (entry.provider && matchesAllowedModels(patterns, `${entry.provider}/*`)) {
    return String(entry.provider);
  }
  return "";
}

const HEALTH = { ready: 3, limited: 2, cooldown: 1, unavailable: 0 };

/** Keep the healthiest row per key: a model served by twenty connections is
 *  still one model, and the card should say so once. */
function betterRow(a, b) {
  const ha = HEALTH[String(a.status || "").toLowerCase()] ?? 3;
  const hb = HEALTH[String(b.status || "").toLowerCase()] ?? 3;
  if (ha !== hb) return ha > hb ? a : b;
  const wa = Number(a.contextWindow) || 0;
  const wb = Number(b.contextWindow) || 0;
  return wb > wa ? b : a;
}

/**
 * One row per model the key may call.
 *
 * The same model is served by many provider connections - deepseek-v4-pro was
 * reached through 21 of them - and the catalog lists each call path. That is
 * right for routing and wrong for a list a person reads: the card showed
 * deepseek-v4-pro twenty-one times and the key looked far less restricted than
 * the twelve models it was actually given. Group by the id the client sends,
 * which is what allowedModels is written against, and keep the healthiest row.
 *
 * Case is folded on the group key only, so `ark/DeepSeek-V4-Pro` and
 * `ds/deepseek-v4-pro` land in one row instead of reading as two different
 * models.
 */
export function collapseModelsByAdmittedId(models, allowedModels) {
  const list = Array.isArray(models) ? models : [];
  const patterns = parseAllowedModels(allowedModels);
  if (!patterns) return [...list];
  const byKey = new Map();
  for (const entry of list) {
    if (!entry) continue;
    const id = admittedId(entry, patterns);
    if (!id) continue;
    const key = id.toLowerCase();
    const prev = byKey.get(key);
    byKey.set(key, prev ? betterRow(prev, entry) : entry);
  }
  return [...byKey.values()];
}

/**
 * Rank statuses from worst to best so a combo or a provider rollup reports its
 * least healthy member. Unknown strings sink to the bottom as "ready".
 */
const STATUS_RANK = { unavailable: 0, cooldown: 1, limited: 2, ready: 3 };

export function normalizeModelStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, s) ? s : "ready";
}

export function worstModelStatus(statuses) {
  let worst = "ready";
  for (const s of statuses || []) {
    const n = normalizeModelStatus(s);
    if (STATUS_RANK[n] < STATUS_RANK[worst]) worst = n;
  }
  return worst;
}
