import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { observeContextWindow } from "./contextWindowRegistry.js";

// OpenRouter publishes every model's real context length, unauthenticated:
//
//   GET https://openrouter.ai/api/v1/models
//   { "data": [ { "id": "stealth/ox-alpha", "context_length": 1048576, ... } ] }
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
 * Fetch the catalogue and record every context length it declares.
 * Returns the number of ids learned. Never throws.
 */
export async function refreshOpenRouterContextWindows({ force = false } = {}) {
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
      for (const item of rows) {
        const id = String(item?.id ?? "").trim();
        const win = windowOf(item);
        if (!id || !win) continue;
        // Record under the ROUTED id, which is what combos store and what
        // modelContextWindow is asked about — not the bare catalogue id.
        if (await observeContextWindow(`${PREFIX}${id}`, win, "openrouter catalogue")) learned++;
      }
      lastFetchedAt = Date.now();
      if (learned) console.log(`[CTXWIN] openrouter: learned ${learned} window(s) from ${rows.length} models`);
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
