// Available-model list builder for the usage page, kept free of imports that
// touch the database so the self-check can load it directly. The catalog entry
// shape mirrors what GET /api/models returns: { provider, model, name,
// fullModel, routedModel, origin } where origin is one of "provider",
// "custom", "studio" or "combo".
import { parseAllowedModels, matchesAllowedModels } from "../db/repos/allowedModels.js";

/**
 * Every id spelling one catalog entry may be called by. The request gate and
 * the /v1/models listing both match the key's patterns against the model id
 * the client actually sends, which is usually `provider/model` or a bare combo
 * or studio name, so an entry is shown when ANY of its spellings matches.
 */
export function modelMatchCandidates(entry) {
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(entry.routedModel);
  push(entry.fullModel);
  push(entry.model);
  push(entry.name);
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
