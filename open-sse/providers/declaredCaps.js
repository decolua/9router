// Operator-declared model capabilities, read from the kv \`customModels\` scope.
//
// The dashboard lets an operator tick capabilities (vision, reasoning, ...) on a
// model they added by hand; that declaration is persisted on the model record.
// Both the /v1/models listing and the request-path modality strip need it, and
// the request path runs on every chat completion — so this module caches the
// whole scope in memory and only re-reads when the cache is invalidated or TTLs
// out.
//
// Resolution is by model id, matching how the rest of the pipeline addresses
// models: the route builds \`{providerAlias}/{id}\` and the request path arrives
// with the bare model id, so lookups accept either form.

import { getCustomModels } from "../../src/lib/db/repos/aliasRepo.js";

/** How long a resolved snapshot stays fresh, in ms. */
const TTL_MS = 30_000;

/** @type {Map<string, object>} modelId -> declared caps */
let cache = new Map();
let cacheAt = 0;
let inflight = null;

/** Build the lookup key for one record. */
function keyFor(record) {
  return String(record?.id ?? "").trim();
}

async function load() {
  const models = await getCustomModels();
  const next = new Map();
  for (const record of models) {
    const key = keyFor(record);
    if (!key) continue;
    if (record?.caps && typeof record.caps === "object") next.set(key, record.caps);
  }
  cache = next;
  cacheAt = Date.now();
  return cache;
}

/** Drop the cache so the next read reflects a fresh write. */
export function invalidateDeclaredModelCaps() {
  cache = new Map();
  cacheAt = 0;
}

/**
 * Declared capabilities for one model, or undefined when the operator declared none.
 *
 * @param {string} provider - provider alias (accepted for symmetry; unused)
 * @param {string} model - bare model id, or "alias/id"
 * @returns {Promise<object|undefined>} the declared caps block, if any
 */
export async function getDeclaredModelCaps(provider, model) {
  const id = typeof model === "string" ? (model.includes("/") ? model.split("/").pop() : model) : "";
  if (!id) return undefined;

  const fresh = Date.now() - cacheAt < TTL_MS;
  if (!fresh) {
    // Collapse concurrent misses into one query.
    inflight ||= load().finally(() => { inflight = null; });
    try {
      await inflight;
    } catch {
      // A read failure must not break the request: fall through to the
      // static-table guess rather than surfacing an error here.
      return undefined;
    }
  }

  return cache.get(id);
}
