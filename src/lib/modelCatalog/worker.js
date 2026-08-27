// Downloads models.dev and writes the capability deltas 9router reads.
// Runs in a worker thread: the 4MB parse would otherwise block requests for ~20ms.

import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";

const FETCH_TIMEOUT_MS = 60000;
const MODALITY_BY_INPUT = { image: "vision", pdf: "pdf", audio: "audioInput", video: "videoInput" };
// Gateways disagree about the same model, so a modality needs a majority of
// them to declare it — one reseller mislabelling a text model must not win.
const MIN_SHARE = 0.5;
// Ignore limit differences below this: gateways round 200000 vs 202752.
const LIMIT_TOLERANCE = 0.1;

// "zai-org/GLM-4.6V:free" -> "glm-4.6v"
function baseId(modelId) {
  const withoutVendor = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  return withoutVendor.toLowerCase().split(":")[0];
}

function build(catalog, entries, providerAliases) {
  // Index the catalog once: per provider for limits, and tallied for modalities.
  const byProvider = {};
  const tally = {};
  for (const [providerId, provider] of Object.entries(catalog)) {
    const models = {};
    for (const [modelId, model] of Object.entries(provider?.models || {})) {
      const id = baseId(modelId);
      models[id] = model;
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
    const alias = providerAliases[provider];
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

// Trimmed copy of the upstream catalog, kept for the add-models skill: same
// 7348 models, 470KB instead of 4.3MB, so a scan reads it in ~5ms.
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

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, contents, "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

async function run() {
  const { url, etag, outFile, rawFile, entries, providerAliases } = workerData;

  const headers = { accept: "application/json" };
  if (etag) headers["if-none-match"] = etag;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (response.status === 304) return { status: "unchanged" };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const catalog = await response.json();
  const nextEtag = response.headers.get("etag") || null;
  const { models, providers } = build(catalog, entries, providerAliases);
  const serialized = JSON.stringify({ v: 1, etag: nextEtag, syncedAt: Date.now(), models, providers });

  writeAtomic(outFile, serialized);
  if (rawFile) writeAtomic(rawFile, JSON.stringify(slim(catalog)));

  return {
    status: "updated",
    etag: nextEtag,
    bytes: Buffer.byteLength(serialized),
    models: Object.keys(models).length,
    providers: Object.keys(providers).length,
  };
}

run().then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error) => parentPort?.postMessage({ ok: false, error: error?.message || String(error) })
);
