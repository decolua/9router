import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { observeContextWindow } from "./contextWindowRegistry.js";
import { observeModalities } from "./modalityRegistry.js";

// OpenRouter publishes every model's real context length AND which inputs it
// accepts, unauthenticated:
//
//   GET https://openrouter.ai/api/v1/models
//   { "data": [ { "id": "stealth/ox-alpha", "context_length": 1048576,
//                 "architecture": { "input_modalities": ["text","image","video"] } } ] }
//
// This is the endpoint that makes the window dynamic. A map of model windows
// goes stale the moment OpenRouter ships anything — and silently, because the
// model still answers, just capped. A map of ONE endpoint does not.
//
// Same shape as grokCliModels.js / kimchiModels.js: a per-provider catalogue
// service. Adding another provider means another file like this one, not
// another row in a table of numbers.
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const REFRESH_MS = 6 * 60 * 60 * 1000;

let lastFetchedAt = 0;
let inFlight = null;

/** Routed ids are `openrouter/<catalogue id>` — the prefix the combos use. */
const PREFIX = "openrouter/";

function windowOf(item) {
  const n = Number(
    item?.context_length ?? item?.contextLength ?? item?.top_provider?.context_length
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Which inputs the catalogue says the model accepts, or null when it says
 * nothing. Absence is not a claim of "text only" — a model with no
 * `input_modalities` is a model we have learned nothing about, and inventing
 * `vision:false` for it would be the same mistake the all-false default already
 * makes. Only a list we can actually read produces flags.
 */
function modalitiesOf(item) {
  const list = item?.architecture?.input_modalities ?? item?.architecture?.inputModalities;
  if (!Array.isArray(list) || list.length === 0) return null;
  const has = (m) => list.some((x) => String(x).toLowerCase() === m);
  return { vision: has("image"), audioInput: has("audio"), videoInput: has("video") };
}

/**
 * Fetch the catalogue and record what it declares: every context length, and
 * every input modality. One GET, two registries — the modality is in the same
 * row as the window, so learning it costs nothing extra.
 * Returns the number of ids whose window changed. Never throws.
 */
export async function refreshOpenRouterCatalogue({ force = false } = {}) {
  if (!force && Date.now() - lastFetchedAt < REFRESH_MS) return 0;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await proxyAwareFetch(MODELS_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`[CTXWIN] openrouter catalogue ${res.status}`);
        return 0;
      }
      const body = await res.json();
      const rows = Array.isArray(body?.data) ? body.data : [];
      let learned = 0;
      let modalities = 0;
      for (const item of rows) {
        const id = String(item?.id ?? "").trim();
        if (!id) continue;
        // Record under the ROUTED id, which is what combos store and what
        // modelContextWindow and getCapabilitiesForModel are asked about — not
        // the bare catalogue id.
        const routed = `${PREFIX}${id}`;
        const win = windowOf(item);
        if (win && await observeContextWindow(routed, win, "openrouter catalogue")) learned++;
        const mods = modalitiesOf(item);
        if (mods && await observeModalities(routed, mods, "openrouter catalogue")) modalities++;
      }
      lastFetchedAt = Date.now();
      if (learned) console.log(`[CTXWIN] openrouter: learned ${learned} window(s) from ${rows.length} models`);
      if (modalities) console.log(`[MODALITY] openrouter: learned ${modalities} modality set(s) from ${rows.length} models`);
      return learned;
    } catch (e) {
      console.warn(`[CTXWIN] openrouter catalogue failed: ${e.message}`);
      return 0;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
