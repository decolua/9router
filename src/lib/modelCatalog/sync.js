// Daily refresh of model capabilities from models.dev.
//
// Downloads the catalog, keeps only what differs from the hand-written tables,
// and writes it next to the database. Failures are swallowed on purpose: a
// stale or missing file just means those tables keep deciding on their own.

import fs from "node:fs";
import path from "node:path";
import { CATALOG_FILE, CATALOG_RAW_FILE, invalidateCatalog, installCatalogSource } from "open-sse/providers/catalogOverride.js";

const CATALOG_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 60000;

export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;   // let the server boot and serve first requests
const RETRY_DELAY_MS = 30 * 60 * 1000;

const MODALITY_BY_INPUT = { image: "vision", pdf: "pdf", audio: "audioInput", video: "videoInput" };
// Gateways disagree about the same model, so a modality needs a majority of
// them to declare it — one reseller mislabelling a text model must not win.
const MIN_SHARE = 0.5;
// Ignore limit differences below this: gateways round 200000 vs 202752.
const LIMIT_TOLERANCE = 0.1;

// 9router provider id -> models.dev provider id, for context/maxOutput only.
// Providers absent here keep whatever the local pattern table resolves; names
// that already match are resolved automatically.
const PROVIDER_ALIASES = {
  "glm": "zai",
  "glm-cn": "zhipuai",
  "claude": "anthropic",
  "gemini": "google",
  "kimi": "moonshotai",
  "kimi-cn": "moonshotai-cn",
  "qwen": "alibaba",
  "qwen-cn": "alibaba-cn",
  "zhipu": "zhipuai",
  "hunyuan": "tencent",
  "doubao": "volcengine",
  "cloudflare-ai": "cloudflare-workers-ai",
};

let state = { running: false, lastSync: null, lastError: null, lastResult: null, etag: null };
let timer = null;

export function getSyncState() {
  return { ...state, file: CATALOG_FILE, url: CATALOG_URL, intervalMs: SYNC_INTERVAL_MS };
}

// "zai-org/GLM-4.6V:free" -> "glm-4.6v"
function baseId(modelId) {
  const withoutVendor = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  return withoutVendor.toLowerCase().split(":")[0];
}

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, contents, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

// Trimmed copy of the upstream catalog, kept for the add-models skill: same
// models, ~470KB instead of 4.3MB.
function slim(catalog) {
  const out = {};
  for (const [providerId, provider] of Object.entries(catalog)) {
    const models = {};
    for (const [modelId, model] of Object.entries(provider?.models || {})) {
      models[modelId] = {
        i: (model?.modalities?.input || []).filter((x) => x !== "text"),
        c: model?.limit?.context,
        o: model?.limit?.output,
        r: model?.reasoning || undefined,
      };
    }
    out[providerId] = models;
  }
  return out;
}

function build(catalog, entries) {
  // Index once: per provider for limits, and tallied across all of them for
  // modalities.
  const byProvider = {};
  const tally = {};
  for (const [providerId, provider] of Object.entries(catalog)) {
    const models = {};
    const counted = new Set();
    for (const [modelId, model] of Object.entries(provider?.models || {})) {
      const id = baseId(modelId);
      models[id] = model;
      // One vote per provider: several ids can normalize to the same model
      // (claude-opus-4-thinking:1024, :8192, :32768 …) and must not stack.
      if (counted.has(id)) continue;
      counted.add(id);
      const counts = tally[id] || (tally[id] = { total: 0 });
      counts.total++;
      for (const input of model?.modalities?.input || []) {
        const key = MODALITY_BY_INPUT[input];
        if (key) counts[key] = (counts[key] || 0) + 1;
      }
    }
    byProvider[providerId] = models;
  }

  // Modalities belong to the model — every gateway serving it has the same
  // weights — so they are keyed by model id and shared across providers.
  const models = {};
  for (const [id, counts] of Object.entries(tally)) {
    const declared = {};
    for (const key of Object.values(MODALITY_BY_INPUT)) {
      if ((counts[key] || 0) / counts.total >= MIN_SHARE) declared[key] = true;
    }
    if (Object.keys(declared).length) models[id] = declared;
  }

  // Limits belong to the gateway — each truncates differently — so only the
  // matching provider's own numbers are used, keyed by provider + model.
  const providers = {};
  for (const { provider, model, contextLength, current } of entries) {
    const alias = PROVIDER_ALIASES[provider];
    const upstream = catalog[provider] ? provider : (alias && catalog[alias] ? alias : null);
    const entry = upstream && byProvider[upstream]?.[baseId(model)];
    if (!entry) continue;

    const delta = {};
    const { context, output } = entry.limit || {};
    if (context > 0 && !contextLength
      && Math.abs(context - current.contextWindow) / current.contextWindow > LIMIT_TOLERANCE) {
      delta.contextWindow = context;
    }
    if (output > 0
      && Math.abs(output - current.maxOutput) / current.maxOutput > LIMIT_TOLERANCE) {
      delta.maxOutput = output;
    }
    if (Object.keys(delta).length) (providers[provider] || (providers[provider] = {}))[model] = delta;
  }

  return { models, providers };
}

// Snapshot every registered model with the capabilities the hand-written tables
// resolve on their own, so build() can tell which upstream values are a change.
//
// The previous catalog MUST be detached first. Leaving it installed makes each
// delta relative to the last one, so a value that still agrees with upstream
// looks like "no change" and is dropped — the file erases itself over two runs.
async function collectEntries() {
  const [{ default: registry }, { getCapabilitiesForModel, setCatalogSource }] = await Promise.all([
    import("open-sse/providers/registry/index.js"),
    import("open-sse/providers/capabilities.js"),
  ]);
  setCatalogSource(null);

  const entries = [];
  for (const provider of registry) {
    for (const model of provider.models || []) {
      entries.push({
        provider: provider.id,
        model: model.id,
        contextLength: model.contextLength,
        current: getCapabilitiesForModel(provider.id, model.id),
      });
    }
  }
  return entries;
}

// Run one sync. Returns a summary, or null when it could not complete.
export async function syncModelCatalog() {
  if (state.running) return null;
  state.running = true;
  try {
    const headers = { accept: "application/json" };
    if (state.etag) headers["if-none-match"] = state.etag;
    const response = await fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    let result;
    if (response.status === 304) {
      result = { status: "unchanged" };
    } else if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    } else {
      // ~23ms to parse, once a day, on a server that is otherwise idle at this
      // point — not worth a worker thread.
      const catalog = await response.json();
      const etag = response.headers.get("etag") || null;
      const entries = await collectEntries();
      const { models, providers } = build(catalog, entries);
      const serialized = JSON.stringify({ v: 1, etag, syncedAt: Date.now(), models, providers });

      writeAtomic(CATALOG_FILE, serialized);
      writeAtomic(CATALOG_RAW_FILE, JSON.stringify(slim(catalog)));

      state.etag = etag;
      invalidateCatalog();
      result = {
        status: "updated",
        etag,
        bytes: Buffer.byteLength(serialized),
        models: Object.keys(models).length,
        providers: Object.keys(providers).length,
      };
      console.log(`[modelCatalog] ${result.models} models, ${result.providers} providers, ${(result.bytes / 1024).toFixed(1)}KB`);
    }

    state.lastSync = Date.now();
    state.lastError = null;
    state.lastResult = result;
    return result;
  } catch (error) {
    state.lastError = error?.message || String(error);
    console.log(`[modelCatalog] sync failed: ${state.lastError}`);
    return null;
  } finally {
    // collectEntries() detaches the reader; put it back whatever happened.
    await installCatalogSource().catch(() => {});
    state.running = false;
  }
}

// The etag lives in the file we wrote, so a restart can resume from it instead
// of re-downloading 4.3MB to be told nothing changed.
function restoreEtag() {
  try {
    state.etag = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8")).etag || null;
    state.lastSync = fs.statSync(CATALOG_FILE).mtimeMs;
  } catch {
    state.etag = null;
  }
}

// Schedule the recurring sync. Disable entirely with MODEL_CATALOG_SYNC=off.
export function startModelCatalogSync() {
  if (timer) return;
  if (String(process.env.MODEL_CATALOG_SYNC || "").toLowerCase() === "off") return;
  restoreEtag();

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      const result = await syncModelCatalog();
      schedule(result ? SYNC_INTERVAL_MS : RETRY_DELAY_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}
