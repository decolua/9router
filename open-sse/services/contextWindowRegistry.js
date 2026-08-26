/**
 * Context windows learned from the providers themselves.
 *
 * WHY THIS EXISTS. `DEFAULT_CAPABILITIES.contextWindow` is 200,000, and any
 * model the static table does not name inherits it. That default is not a
 * neutral guess — it is load-bearing. `shouldSkipModel` compares the request to
 * it, and `compactCeiling` derives the client's compaction trigger from it. So a
 * 1M model nobody has hand-written an entry for is advertised at 200K, the
 * router 413s every request past 160K, and 80% of the window the model was
 * chosen for is thrown away. Observed 2026-08-24 on `openrouter/stealth/ox-alpha`
 * within an hour of it becoming the head of Yggdrasil: the client's HUD read
 * "0% (1M)" while the gateway forced a compact five times sooner.
 *
 * The obvious fix — add ox-alpha to the static table — is the wrong one, and
 * the operator said so: "i told you to make it dynamic and not hardcoded map. so
 * it never stale." A table of model windows goes stale the moment a provider
 * ships anything, and the failure is silent: the model still works, it is just
 * quietly capped. A table of *endpoints* does not, because endpoints outlive the
 * models behind them. So this learns the number from whoever actually knows it.
 *
 * PRECEDENCE, and the reason for it:
 *   1. a window learned from the provider's own catalogue or its own error
 *   2. the static table in providers/capabilities.js
 *   3. the 200K default
 * Learned beats static because the provider is the authority on its own model,
 * and because a stale static entry is exactly the failure this replaces. The
 * static table keeps its job as the seed for providers that publish no catalogue.
 */

import { getAdapter } from "@/lib/db/driver.js";

/** kv scope. Persisted, because relearning on every restart would mean serving
 *  the first requests after a deploy against the wrong window. */
const SCOPE = "contextWindows";

/** Beyond this a "window" is a parsing accident, not a model. */
const MIN_WINDOW = 1000;
const MAX_WINDOW = 20_000_000;

/** Re-read from disk at most this often; the map is small and rarely changes. */
const CACHE_TTL_MS = 60_000;

// Held on `global`, not in module scope, and that is not incidental. Next
// bundles instrumentation, API routes and the chat path into separate module
// registries, so a plain module-level Map gives each of them its own empty
// copy: the learner fills one, the sizing path reads another, and the window
// stays at the 200K default while the log cheerfully reports 422 windows
// learned. Measured exactly that way before this line existed. Same reason
// db/driver.js keeps its adapter on `global._dbAdapter`.
if (!global.__9rContextWindows) global.__9rContextWindows = { cache: new Map(), cachedAt: 0 };
const store = global.__9rContextWindows;

async function load() {
  if (store.cache.size && Date.now() - store.cachedAt < CACHE_TTL_MS) return store.cache;
  try {
    const db = await getAdapter();
    const next = new Map();
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE])) {
      const n = Number(r.value);
      if (Number.isFinite(n) && n > 0) next.set(r.key, n);
    }
    store.cache = next;
    store.cachedAt = Date.now();
  } catch {
    // No DB yet (early boot, or a runtime without one): the static table still
    // answers. Never throw from a sizing path.
  }
  return store.cache;
}

/**
 * Record a window we were told about.
 * @param {string} modelId routed id, e.g. "openrouter/stealth/ox-alpha"
 * @param {number} window tokens
 * @param {string} source free text, for the log line only
 */
export async function observeContextWindow(modelId, window, source = "provider") {
  const n = Number(window);
  if (!modelId || !Number.isFinite(n) || n < MIN_WINDOW || n > MAX_WINDOW) return false;
  const known = (await load()).get(modelId);
  if (known === n) return false;
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, modelId, String(n)]
    );
    store.cache.set(modelId, n);
    console.log(`[CTXWIN] ${modelId} = ${n} (${source}${known ? `, was ${known}` : ""})`);
    return true;
  } catch (e) {
    console.warn(`[CTXWIN] could not persist ${modelId}: ${e.message}`);
    return false;
  }
}

/** The learned window for a routed id, or 0. Synchronous against the cache so
 *  the hot sizing path never awaits; `load()` is driven by the refresher. */
export function learnedContextWindow(modelId) {
  // Lazy prime, fire-and-forget: whichever bundle asks first warms the shared
  // map for all of them. Never awaited — sizing runs on every request.
  if (!store.cache.size && !store.priming) {
    store.priming = true;
    load().finally(() => { store.priming = false; });
  }
  return store.cache.get(modelId) || 0;
}

/** Warm the cache. Called at boot and by the catalogue refresher. */
export async function primeContextWindows() {
  await load();
  return store.cache.size;
}

export function __setForTests(map) {
  store.cache = new Map(map);
  store.cachedAt = Date.now();
}
