/**
 * Input modalities learned from the providers themselves.
 *
 * WHY THIS EXISTS. `DEFAULT_CAPABILITIES.vision` is false, and any model the
 * static table does not name inherits it. Like the context-window default, that
 * false is load-bearing in two places at once:
 *
 *   - `reorderByCapabilities` treats vision as a HARD capability, so a request
 *     carrying an image promotes whatever member is declared vision-capable to
 *     the head of the combo — and `compactCeiling` then derives the client's
 *     compaction trigger from *that* member's window.
 *   - `chatCore` calls `stripUnsupportedModalities` with the same flags, so a
 *     model declared blind has the image removed from its request and answers
 *     from the text alone.
 *
 * Measured 2026-08-25 on `openrouter/stealth/ox-alpha`, which has no entry in
 * the static table and therefore inherited `vision:false`. One screenshot in a
 * Claude Code session demoted the 1M head to a 200K vision member, the ceiling
 * collapsed from 838,860 to 160,000, the gateway 413'd, and the client answered
 * that 413 with an auto-compact that could not help. The catalogue had said
 * `input_modalities: ["text","image","video"]` the whole time. Probed directly,
 * ox-alpha reads a 64x64 half-and-half PNG correctly on both colour pairs.
 *
 * This is the same shape as services/contextWindowRegistry.js and exists for the
 * same reason: a table of models goes stale the moment a provider ships
 * anything, silently, because the model still answers — it is just quietly
 * capped, or quietly blind. A table of endpoints does not.
 *
 * PRECEDENCE — AND IT IS DELIBERATELY THE OPPOSITE OF contextWindowRegistry:
 *   1. an explicit entry in providers/capabilities.js
 *   2. a modality learned from the provider's own catalogue
 *   3. the all-false default
 *
 * Learned does NOT beat the static table here. For a context window the
 * provider is simply the authority on its own number. For a modality it is not:
 * `ag/claude-opus-4-6-thinking` and `ag/claude-sonnet-4-6` are advertised
 * vision-capable by Antigravity and are declared `vision:false` in the table on
 * purpose, because the executor's Claude branch drops the image on the floor
 * (see providers/capabilities.js and the 2026-08-23 probe). A learned-wins rule
 * would silently re-break exactly those two, and the failure has no error — the
 * model answers from the text and guesses. So the catalogue fills the gaps the
 * table leaves, and never argues with it. Do not "make this consistent" with the
 * window registry.
 */

import { getAdapter } from "@/lib/db/driver.js";
import { setLearnedModalityLookup } from "../providers/capabilities.js";

/** kv scope. Persisted, because relearning on every restart would mean serving
 *  the first requests after a deploy against the wrong modality. */
const SCOPE = "modalities";

/** The input modalities worth learning. Deliberately not `pdf`: OpenRouter's
 *  catalogue says "file", which is not the same claim, and guessing one from
 *  the other is how a wrong flag gets in here in the first place. */
const LEARNABLE = ["vision", "audioInput", "videoInput"];

/** Re-read from disk at most this often; the map is small and rarely changes. */
const CACHE_TTL_MS = 60_000;

// Held on `global` for the reason spelled out in contextWindowRegistry.js: Next
// gives instrumentation, API routes and the chat path separate module
// registries, so a module-level Map means the learner fills one copy while the
// routing path reads another empty one.
if (!global.__9rModalities) global.__9rModalities = { cache: new Map(), cachedAt: 0 };
const store = global.__9rModalities;

/** Keep only known boolean flags; anything else is a parsing accident. */
function sanitize(caps) {
  if (!caps || typeof caps !== "object") return null;
  const out = {};
  for (const k of LEARNABLE) {
    if (typeof caps[k] === "boolean") out[k] = caps[k];
  }
  return Object.keys(out).length ? out : null;
}

function sameCaps(a, b) {
  if (!a || !b) return false;
  return LEARNABLE.every((k) => a[k] === b[k]);
}

async function load() {
  if (store.cache.size && Date.now() - store.cachedAt < CACHE_TTL_MS) return store.cache;
  try {
    const db = await getAdapter();
    const next = new Map();
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE])) {
      try {
        const caps = sanitize(JSON.parse(r.value));
        if (caps) next.set(r.key, caps);
      } catch {
        // A row we cannot parse is a row we ignore; the static table still answers.
      }
    }
    store.cache = next;
    store.cachedAt = Date.now();
  } catch {
    // No DB yet (early boot, or a runtime without one): the static table still
    // answers. Never throw from a routing path.
  }
  return store.cache;
}

/**
 * Record modalities we were told about.
 * @param {string} modelId routed id, e.g. "openrouter/stealth/ox-alpha"
 * @param {{vision?: boolean, audioInput?: boolean, videoInput?: boolean}} caps
 * @param {string} source free text, for the log line only
 */
export async function observeModalities(modelId, caps, source = "provider") {
  const clean = sanitize(caps);
  if (!modelId || !clean) return false;
  const known = (await load()).get(modelId);
  if (sameCaps(known, clean)) return false;
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, modelId, JSON.stringify(clean)]
    );
    store.cache.set(modelId, clean);
    const on = LEARNABLE.filter((k) => clean[k]);
    console.log(`[MODALITY] ${modelId} = ${on.length ? on.join("+") : "text only"} (${source})`);
    return true;
  } catch (e) {
    console.warn(`[MODALITY] could not persist ${modelId}: ${e.message}`);
    return false;
  }
}

/** The learned modalities for a routed id, or null. Synchronous against the
 *  cache so the routing path never awaits; `load()` is driven by the refresher. */
export function learnedModalities(modelId) {
  // Lazy prime, fire-and-forget: whichever bundle asks first warms the shared
  // map for all of them. Never awaited — this runs on every request.
  if (!store.cache.size && !store.priming) {
    store.priming = true;
    load().finally(() => { store.priming = false; });
  }
  return store.cache.get(modelId) || null;
}

/** Warm the cache. Called at boot and by the catalogue refresher. */
export async function primeModalities() {
  await load();
  return store.cache.size;
}

export function __setForTests(map) {
  store.cache = new Map(map);
  store.cachedAt = Date.now();
}

// Push the lookup INTO capabilities.js rather than letting it import this file.
//
// The dependency has to run this way round. providers/capabilities.js is
// reachable from client components (a dashboard provider page renders model
// capabilities), and this file reaches the SQLite driver — so an import in the
// other direction pulls `node:sqlite` into a browser bundle and the build fails
// outright with "Reading from node:sqlite is not handled by plugins". A dynamic
// import does not save it: webpack still follows the static specifier.
//
// Registration happens per module registry, not per process. Next bundles
// instrumentation, API routes and the chat path separately, so each gets its own
// copy of capabilities.js and must register its own lookup — services/combo.js
// imports this file for exactly that reason. They still share one cache, because
// the cache is held on `global` (see above).
setLearnedModalityLookup(learnedModalities);
