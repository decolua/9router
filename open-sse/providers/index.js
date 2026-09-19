// Single source: build PROVIDERS + PROVIDER_MODELS from registry/{id}.js (transport + models co-located).
import REGISTRY from "./registry/index.js";
import { PROVIDER_DEFAULTS } from "./schema.js";
import { normalizeModel } from "./models/schema.js";
import { buildTtsProviderModels } from "../config/ttsModels.js";

// oauth block is canonical for these fields; inject into transport so executors reading
// this.config.{clientId,clientSecret,tokenUrl} keep working without duplicating in transport
const OAUTH_INJECT_FIELDS = ["clientId", "clientSecret", "tokenUrl"];

// transport: re-apply shared default (format:"openai") + inject oauth-canonical fields
function buildTransport(transport, oauth) {
  const t = { ...transport };
  if (!t.format) t.format = PROVIDER_DEFAULTS.format;
  if (oauth) {
    for (const f of OAUTH_INJECT_FIELDS) {
      if (t[f] === undefined && oauth[f] !== undefined) t[f] = oauth[f];
    }
  }
  return t;
}

const MEDIA_KEYS = new Set([
  "serviceKinds", "ttsConfig", "sttConfig", "embeddingConfig",
  "imageConfig", "imageToTextConfig", "videoConfig", "musicConfig",
  "searchViaChat", "searchConfig", "fetchConfig",
  "modelsFetcher", "mediaPriority", "hiddenKinds",
]);

// Canonical JSON (sorted object keys) so "same list, different key insertion order"
// compares equal — we only want to flag real catalog divergence, not serialization noise.
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// PROVIDER_MODELS key = entry.alias || entry.id. If two registry entries map to the
// same key the write is last-writer-wins (preserved on purpose: renaming/deduping keys
// would change routing). Policy: warn ONLY when the normalized lists DIFFER, naming both
// origins — today's sole collision (mimo-free alias "mmf" vs mmf id "mmf") has identical
// lists, so it stays silent and a differing catalog edit becomes visible instead of quiet.
/** Exported for tests (map-equality proof). */
export function buildProviderModelMap(entries, target = {}) {
  const writers = new Map();
  const label = (e) => (e.alias ? `${e.id} (alias "${e.alias}")` : `${e.id} (id)`);
  for (const entry of entries) {
    if (entry.models === undefined) continue;
    const key = entry.alias || entry.id;
    const models = entry.models.map(normalizeModel);
    const prev = writers.get(key);
    if (prev && stableStringify(prev.models) !== stableStringify(models)) {
      console.warn(
        `[providers] PROVIDER_MODELS key "${key}" collision: ${label(prev)} vs ${label(entry)} ` +
          `have DIFFERENT model lists — keeping last-writer ${entry.id} (registry order, unchanged behavior)`,
      );
    }
    target[key] = models;
    writers.set(key, { models, id: entry.id, alias: entry.alias });
  }
  return target;
}

export const PROVIDERS = {};
export const PROVIDER_MODELS = {};
export const PROVIDER_OAUTH = {};
export const PROVIDER_MEDIA = {};
for (const entry of REGISTRY) {
  if (entry.transport) {
    PROVIDERS[entry.id] = buildTransport(entry.transport, entry.oauth);
    if (entry.transports) PROVIDERS[entry.id].transports = entry.transports;
  }
  if (entry.oauth) PROVIDER_OAUTH[entry.id] = entry.oauth;
  // Build PROVIDER_MEDIA from top-level fields (post-migration) + legacy entry.media
  const mediaFields = {};
  for (const k of MEDIA_KEYS) {
    if (entry[k] !== undefined) mediaFields[k] = entry[k];
  }
  if (entry.media) Object.assign(mediaFields, entry.media);
  if (Object.keys(mediaFields).length) PROVIDER_MEDIA[entry.id] = mediaFields;
}

// Single pass over REGISTRY for PROVIDER_MODELS (collision-aware; key order = registry order, as before)
buildProviderModelMap(REGISTRY, PROVIDER_MODELS);

// TTS model/voice tables keyed by special names (openai-tts-models, ...), not provider ids
Object.assign(PROVIDER_MODELS, buildTtsProviderModels());
