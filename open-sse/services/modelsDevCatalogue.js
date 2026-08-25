import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { observeContextWindow } from "./contextWindowRegistry.js";
import REGISTRY from "../providers/registry/index.js";

// The second catalogue, for the providers that publish no window of their own.
//
// WHY THIS EXISTS. openrouterModels.js made the window dynamic for exactly one
// provider, because OpenRouter is the only one of ours whose own model list
// carries `context_length`. Everybody else answers `GET /models` with bare ids —
// opencode's `https://opencode.ai/zen/v1/models` returns `{"id":"x-preview-f-free",
// "object":"model","owned_by":"opencode"}` and nothing else. So every opencode
// model fell through to `DEFAULT_CAPABILITIES.contextWindow` = 200,000, and
// `shouldSkipModel` dropped it from every combo the moment a conversation passed
// 200K:
//
//   [COMBO] Skipping oc/x-preview-f-free, request needs ~274932 tokens but window is 200000
//
// That model's real window is 1,000,000. It is the same ox-alpha the OpenRouter
// leg serves at 1,048,576 — the redundancy pair was silently half-crippled, and
// the only symptom was a combo that ran out of members early.
//
// models.dev is the catalogue those numbers came from in the first place: the
// `limit.context -> contextWindow / limit.output -> maxOutput` mapping written at
// the top of providers/capabilities.js is its shape. The static table is a
// hand-copied snapshot of it. Fetching it instead is the same move
// openrouterModels.js already made, for the other 24 providers we share with it.
//
// PRECEDENCE. A provider that reports its own window is the authority on it, so
// this never overwrites one. The registry has no source ranking — last writer
// wins — so the exclusion has to live here.
//
// The test is "does that catalogue service call observeContextWindow", not "does
// a catalogue service exist". Seven of the eight (grok-cli, kimchi, copilot,
// cursor, kiro, qoder, clinepass) resolve nothing but ids and names, so
// excluding them would protect a number they never write and leave their models
// on the 200K default for nothing. Only openrouterModels.js records a window.
const MODELS_URL = "https://models.dev/api.json";
const REFRESH_MS = 6 * 60 * 60 * 1000;

/** Providers that report their own context window. models.dev must not overwrite
 *  what the provider itself said. Keyed by provider `id`; add one here only when
 *  its service actually calls observeContextWindow. */
const REPORTS_OWN_WINDOW = new Set(["openrouter"]);

let lastFetchedAt = 0;
let inFlight = null;

/**
 * Every prefix a routed id for this provider can start with.
 *
 * There is no single canonical one, and assuming there was is how this would
 * quietly do nothing. The same model reaches the sizing path under more than one
 * spelling — the combo stores `bb/gpt-5.3-codex` while the executor logs
 * `blackbox/gpt-5.3-codex` — so recording under one form leaves the other on the
 * 200K default. Writing all of them is a few thousand rows in a kv table and
 * removes the guesswork; only the spelling actually asked for is ever read.
 */
function prefixesOf(entry) {
  const out = new Set();
  for (const v of [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases || [])]) {
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return out;
}

/** models.dev keys providers by the same id we do, for the ones we share. */
function joinable() {
  const byId = new Map();
  for (const entry of REGISTRY) {
    if (!entry?.id || REPORTS_OWN_WINDOW.has(entry.id)) continue;
    byId.set(entry.id, prefixesOf(entry));
  }
  return byId;
}

/**
 * Fetch models.dev and record `limit.context` for every model of every provider
 * we share with it. Returns the number of ids whose window changed. Never throws.
 */
export async function refreshModelsDevCatalogue({ force = false } = {}) {
  if (!force && Date.now() - lastFetchedAt < REFRESH_MS) return 0;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await proxyAwareFetch(MODELS_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.warn(`[CTXWIN] models.dev catalogue ${res.status}`);
        return 0;
      }
      const body = await res.json();
      if (!body || typeof body !== "object") return 0;

      const ours = joinable();
      let learned = 0;
      let providers = 0;
      for (const [providerId, prefixes] of ours) {
        const models = body?.[providerId]?.models;
        if (!models || typeof models !== "object") continue;
        providers++;
        for (const [modelId, model] of Object.entries(models)) {
          const win = Number(model?.limit?.context);
          if (!Number.isFinite(win) || win <= 0) continue;
          for (const prefix of prefixes) {
            if (await observeContextWindow(`${prefix}/${modelId}`, win, "models.dev catalogue")) learned++;
          }
        }
      }
      lastFetchedAt = Date.now();
      if (learned) {
        console.log(`[CTXWIN] models.dev: learned ${learned} window(s) across ${providers} provider(s)`);
      }
      return learned;
    } catch (e) {
      console.warn(`[CTXWIN] models.dev catalogue failed: ${e.message}`);
      return 0;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
