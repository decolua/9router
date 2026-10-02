/**
 * Server-side reader for user-declared capabilities on custom models.
 *
 * Split from catalogOverride.js on purpose: the synced catalog is a file the
 * server refreshes from models.dev, while custom caps are user data in the
 * local DB. Two different lifetimes, two different invalidation stories.
 *
 * capabilities.js is bundled into the browser, so it cannot import the DB —
 * the server pushes this reader in the same way as the catalog source (#4301).
 */
import { getCustomModels } from "@/lib/db/index.js";

const baseId = (model) => (String(model).includes("/") ? String(model).split("/").pop() : String(model));

// Requests hit this on every model resolution, so the map is cached and only
// rebuilt when a custom model is actually added or removed.
let cache = null;

export function invalidateCustomCaps() {
  cache = null;
}

async function load() {
  if (cache) return cache;
  const byKey = new Map();
  try {
    const models = await getCustomModels();
    for (const m of models || []) {
      if (!m?.id || !m?.providerAlias) continue;
      if ((m.kind || m.type || "llm") !== "llm") continue;
      if (!m.caps || typeof m.caps !== "object") continue;
      byKey.set(`${m.providerAlias}:${baseId(m.id)}`, m.caps);
      byKey.set(`${m.providerAlias}:${m.id}`, m.caps);
    }
  } catch {
    // Fail open: an unreadable store must not strip capability data.
  }
  cache = { byKey };
  return cache;
}

/**
 * Declared caps for a custom model, or null when the user has said nothing.
 * @param {string} provider provider alias
 * @param {string} model model id (with or without a vendor prefix)
 * @returns {object|null}
 */
export async function getCustomModelCaps(provider, model) {
  if (!provider || !model) return null;
  const { byKey } = await load();
  return byKey.get(`${provider}:${baseId(model)}`) || byKey.get(`${provider}:${model}`) || null;
}

// capabilities.js resolves synchronously on the request path, so the reader it
// receives must be sync. Prime the cache once at startup and keep a plain map
// behind it; invalidateCustomCaps() rebuilds it on the next request.
let ready = false;
let syncMap = new Map();

export async function installCustomCapsSource() {
  await prime();
  const { setCustomCapsSource } = await import("./capabilities.js");
  setCustomCapsSource({
    getCaps: (provider, model) => {
      if (!provider || !model) return null;
      return syncMap.get(`${provider}:${baseId(model)}`) || syncMap.get(`${provider}:${model}`) || null;
    },
  });

  // The DB repo calls this after any add/delete. It cannot import this module
  // (that would pull the DB into the browser bundle), so the hook is published
  // on globalThis instead — the same pattern capabilities.js uses for its
  // catalog source.
  if (typeof globalThis !== "undefined") {
    globalThis.__9rCustomCapsInvalidate = async () => {
      cache = null;
      await prime();
    };
  }
}

export async function prime() {
  const { byKey } = await load();
  syncMap = byKey;
  ready = true;
}

export { ready };
