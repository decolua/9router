// Daily refresh of model capabilities from models.dev.
//
// Downloads the catalog, keeps only what differs from the hand-written tables,
// and writes it next to the database. Failures are swallowed on purpose: a
// stale or missing file just means those tables keep deciding on their own.

import fs from "node:fs";
import path from "node:path";
import { getCapabilitiesForModel, getCatalogSource, setCatalogSource } from "open-sse/providers/capabilities.js";
import { CATALOG_FILE, CATALOG_RAW_FILE, CATALOG_VERSION, invalidateCatalog, installCatalogSource } from "open-sse/providers/catalogOverride.js";

const CATALOG_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 60000;

export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;   // let the server boot and serve first requests
const RETRY_DELAY_MS = 30 * 60 * 1000;

const MODALITY_BY_INPUT = { image: "vision", pdf: "pdf", audio: "audioInput", video: "videoInput" };
// Ignore limit differences below this: gateways round 200000 vs 202752.
const LIMIT_TOLERANCE = 0.1;

// 9router provider id -> models.dev provider id: the same gateway under another
// name. Both halves of the catalog are stored against the local id, so this runs
// while building rather than on every lookup. Providers absent here keep whatever
// the local pattern table resolves; names that already match need no entry.
export const PROVIDER_ALIASES = {
  "github": "github-copilot",
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

let state = { running: false, lastSync: null, lastError: null, lastResult: null, etag: null, fileVersion: null };
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

export function build(catalog, entries) {
  // Upstream provider id -> the local ids it belongs to, taken from the registry
  // snapshot so a gateway listed upstream under another name is still filed
  // under the name requests arrive with. One upstream name can back more than one
  // local id (glm-cn and zhipu are both zhipuai) and each has to resolve; the
  // snapshot only covers the built-in registry, so an upstream provider it does
  // not mention keeps its own name.
  const localIds = new Map();
  for (const { provider } of entries) {
    const upstreamId = PROVIDER_ALIASES[provider] || provider;
    let locals = localIds.get(upstreamId);
    if (!locals) localIds.set(upstreamId, (locals = []));
    if (!locals.includes(provider)) locals.push(provider);
  }

  // The registry snapshot's own answer per provider+model, so a limit the tables
  // already agree with upstream is still recognised as "no change" and dropped
  // from the file. Only registry models are keyed here, so a model absent from
  // the snapshot is resolved against the tables right here.
  const snapshot = new Map();
  for (const { provider, model, current } of entries) {
    snapshot.set(`${provider}:${baseId(model)}`, current);
  }

  // A registry entry can declare its window outright (contextLength). Upstream
  // must not override that declaration — it is the gateway's own number — but it
  // may still correct the output limit, which the declaration says nothing about.
  const declaredLength = new Set();
  for (const { provider, model, contextLength } of entries) {
    if (contextLength) declaredLength.add(`${provider}:${baseId(model)}`);
  }

  // Models outside the registry are resolved against the tables here, and that
  // must read the tables alone: with the catalog this run replaces still
  // installed, a value it already carries looks like "no change" and its delta
  // is dropped, so the file erases itself over two runs. The sync detaches
  // before calling; build() enforces it too so a direct caller cannot corrupt
  // its own output.
  const detach = getCatalogSource();
  setCatalogSource(null);
  try {
    return buildLimits(catalog, localIds, snapshot, declaredLength);
  } finally {
    setCatalogSource(detach);
  }
}

function buildLimits(catalog, localIds, snapshot, declaredLength) {
  // Modalities are recorded per gateway upstream and gateways disagree about the
  // same weights — some do not proxy images at all — so the key is provider +
  // model. Keying by model id alone let short ids collide across vendors: "auto",
  // "free" and "efficient" are router modes in one catalog and model names in
  // another, so a router mode inherited a stranger's vision.
  const models = {};
  // Limits belong to the gateway — each truncates differently — so only the
  // matching provider's own numbers are used, keyed by provider + model.
  const providers = {};
  for (const [providerId, provider] of Object.entries(catalog)) {
    // Modalities may be filed under the upstream name as well (a custom provider
    // node can carry it), and they only ever turn a capability on.
    const locals = localIds.get(providerId) || [providerId];
    // Limits replace a number instead of adding to one, so they get the local
    // ids requests arrive with and nothing else: models.dev's view of a gateway
    // 9router does not register is not this router's answer.
    const limitLocals = localIds.get(providerId);
    const seen = new Set();
    for (const [modelId, model] of Object.entries(provider?.models || {})) {
      const id = baseId(modelId);
      // One entry per provider+model: several upstream ids can normalize to the
      // same model (claude-opus-4-thinking:1024, :8192, :32768 …) and must not
      // stack their modalities. This guard is for the modality pass only — the
      // limits pass below must still see every record, so the last one carrying
      // a limit for a baseId keeps the pick the old per-entry index made
      // (openrouter's .../gemma-4-31b-it:free and .../gemma-4-31b-it normalize
      // to one id and carry different windows, so first-vs-last is a choice that
      // has to stay the one it was).
      const firstForId = !seen.has(id);
      if (firstForId) seen.add(id);
      const declared = {};
      for (const input of model?.modalities?.input || []) {
        const key = MODALITY_BY_INPUT[input];
        if (key) declared[key] = true;
      }
      if (firstForId && Object.keys(declared).length) {
        // Filed under every local id requests arrive with, and under the upstream
        // id too: a custom provider node can carry the upstream name without
        // appearing in the registry snapshot, and nothing else would resolve for
        // it. The reader takes whichever key it is handed.
        for (const local of locals) models[`${local}:${id}`] = declared;
        if (!locals.includes(providerId)) models[`${providerId}:${id}`] = declared;
      }

      // Limits are collected for every model the gateway lists upstream, not
      // just the ones the static registry enumerates. The registry is a curated
      // subset — nvidia lists 11 of models.dev's 52 — and a model outside it
      // (one the registry has not caught up on, or one a user added by hand) is
      // still routable, so its real window has to reach the reader. Without this
      // the hand-written patterns decide alone, and a generic row publishes a
      // fraction of the true window: nvidia's stepfun-ai/step-5-preview read
      // 128000 from `*step-*` against upstream's 1048576, and the combo page
      // showed the smaller of its seats.
      const { context, output } = model?.limit || {};
      // A record with no limit cannot overwrite one before it, so a baseId's
      // published window comes from the last record that carries a limit. The
      // old index kept the last record outright, so it dropped the window when
      // that record had none; keeping the limit is the better half of the two.
      if (!(context > 0 || output > 0) || !limitLocals) continue;
      for (const local of limitLocals) {
        const current = snapshot.get(`${local}:${id}`)
          || getCapabilitiesForModel(local, modelId);
        const delta = {};
        if (context > 0 && !declaredLength.has(`${local}:${id}`) && current.contextWindow > 0
          && Math.abs(context - current.contextWindow) / current.contextWindow > LIMIT_TOLERANCE) {
          delta.contextWindow = context;
        }
        if (output > 0 && current.maxOutput > 0
          && Math.abs(output - current.maxOutput) / current.maxOutput > LIMIT_TOLERANCE) {
          delta.maxOutput = output;
        }
        if (Object.keys(delta).length) {
          (providers[local] || (providers[local] = {}))[id] = delta;
        }
      }
    }
  }

  return { models, providers };
}

// Snapshot every registered model with the capabilities the hand-written tables
// resolve on their own, so build() can tell which upstream values are a change.
//
// The previous catalog MUST be detached first. Leaving it installed makes each
// delta relative to the last one, so a value that still agrees with upstream
// looks like "no change" and is dropped — the file erases itself over two runs.
// build() detaches around its own resolution too, but this snapshot runs before
// it, so it has to do the same.
async function collectEntries() {
  const { default: registry } = await import("open-sse/providers/registry/index.js");
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
    // A file written by an older schema has to be rebuilt even when upstream is
    // unchanged, so only ask upstream for a 304 when the file is current.
    if (state.etag && state.fileVersion === CATALOG_VERSION) headers["if-none-match"] = state.etag;
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
      const serialized = JSON.stringify({ v: CATALOG_VERSION, etag, syncedAt: Date.now(), models, providers });

      writeAtomic(CATALOG_FILE, serialized);
      writeAtomic(CATALOG_RAW_FILE, JSON.stringify(slim(catalog)));

      state.etag = etag;
      state.fileVersion = CATALOG_VERSION;
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
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    state.etag = parsed.etag || null;
    state.fileVersion = parsed.v || 1;
    state.lastSync = fs.statSync(CATALOG_FILE).mtimeMs;
  } catch {
    state.etag = null;
    state.fileVersion = null;
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
