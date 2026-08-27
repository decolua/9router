// Background refresh of model capabilities from models.dev.
//
// Failures are swallowed on purpose: a stale or missing catalog just means the
// hand-written capability tables keep deciding on their own.

import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { CATALOG_FILE, CATALOG_RAW_FILE, invalidateCatalog, installCatalogSource } from "open-sse/providers/catalogOverride.js";

const CATALOG_URL = "https://models.dev/api.json";
const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");

// 9router provider id -> models.dev provider id, for context/maxOutput only.
// Providers absent here keep whatever the local pattern table resolves; the
// names that already match are resolved automatically.
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

export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;   // let the server boot and serve first requests
const RETRY_DELAY_MS = 30 * 60 * 1000;
const WORKER_TIMEOUT_MS = 120000;

let state = { running: false, lastSync: null, lastError: null, lastResult: null, etag: null };
let timer = null;

export function getSyncState() {
  return { ...state, file: CATALOG_FILE, url: CATALOG_URL, intervalMs: SYNC_INTERVAL_MS };
}

// Snapshot every registered model with its currently resolved capabilities, so
// the worker can compute a delta without importing app modules (it cannot
// resolve the bundler-only "open-sse/*" alias).
async function collectEntries() {
  const [{ default: registry }, { getCapabilitiesForModel }] = await Promise.all([
    import("open-sse/providers/registry/index.js"),
    import("open-sse/providers/capabilities.js"),
  ]);
  await installCatalogSource();

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

function runWorker(entries) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {
      workerData: {
        url: CATALOG_URL,
        etag: state.etag,
        outFile: CATALOG_FILE,
        rawFile: CATALOG_RAW_FILE,
        entries,
        providerAliases: PROVIDER_ALIASES,
      },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    };
    const timeout = setTimeout(() => {
      worker.terminate();
      finish(reject, new Error("sync timed out"));
    }, WORKER_TIMEOUT_MS);

    worker.on("message", (msg) => {
      if (msg?.ok) finish(resolve, msg.result);
      else finish(reject, new Error(msg?.error || "sync failed"));
    });
    worker.on("error", (err) => finish(reject, err));
    worker.on("exit", (code) => finish(reject, new Error(`worker exited with ${code}`)));
  });
}

// Run one sync. Returns the worker summary, or null when it could not complete.
export async function syncModelCatalog() {
  if (state.running) return null;
  state.running = true;
  try {
    const result = await runWorker(await collectEntries());
    if (result.status === "updated") {
      state.etag = result.etag;
      invalidateCatalog();
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
    state.running = false;
  }
}

// Schedule the recurring sync. Disable entirely with MODEL_CATALOG_SYNC=off.
export function startModelCatalogSync() {
  if (timer) return;
  if (String(process.env.MODEL_CATALOG_SYNC || "").toLowerCase() === "off") return;

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      const result = await syncModelCatalog();
      schedule(result ? SYNC_INTERVAL_MS : RETRY_DELAY_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}
