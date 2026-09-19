import { getProviderConnections, getProviderConnectionById, updateProviderConnection } from "@/models";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard.js";
import { classifyTier } from "@/shared/utils/modelTier.js";
import REGISTRY from "open-sse/providers/registry/index.js";

export { classifyTier };

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETRY_DELAY_MS = 30 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 15_000;
// A model is only treated as removed after this many consecutive successful
// syncs without it. A single absence (rotation, partial outage, pagination
// glitch) keeps it pending-removal and still advertised.
export const RETRY_AFTER_MISSING = 2;

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inferKindFromId(id) {
  const lower = String(id).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/\b(tts|speech|audio|voice)\b/.test(lower)) return "tts";
  if (/(image|imagen|dall-?e|flux|sdxl|stable-diffusion)/.test(lower)) return "image";
  return "llm";
}

export function normalizedModels(payload, { providerId = null } = {}) {
  const rows = Array.isArray(payload) ? payload : payload?.data || payload?.models || [];
  return rows.map((row) => {
    const rawId = row?.id ?? row?.model ?? row?.name;
    if (!rawId || typeof rawId !== "string") return null;
    const id = rawId.trim();
    if (!id) return null;
    const { tier, tierSource } = classifyTier({ ...row, id }, { providerId });
    const prompt = toNumber(row?.pricing?.prompt ?? row?.input_price);
    const completion = toNumber(row?.pricing?.completion ?? row?.output_price);
    return {
      id,
      name: row?.name || row?.display_name || id,
      tier,
      tierSource,
      pricing: prompt === null && completion === null ? null : { prompt, completion },
      contextLength: toNumber(row?.context_length ?? row?.contextLength) ?? undefined,
      capabilities: row?.capabilities && typeof row.capabilities === "object" ? row.capabilities : undefined,
      kind: row?.kind || inferKindFromId(id),
    };
  }).filter(Boolean);
}

function modelsUrlFromBase(baseUrl) {
  // Chat overrides (Alibaba MaaS, custom OpenAI/Anthropic nodes) store the
  // full chat endpoint. Strip the chat leaf so /models resolves on the same host.
  let base = String(baseUrl).trim().replace(/\/$/, "");
  base = base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/messages$/i, "")
    .replace(/\/responses$/i, "");
  return `${base}/models`;
}

// Fetcher types whose /models response is OpenAI-list shaped ({ data: [...] })
// and safe for per-account catalog sync + free-tier classification.
// openrouter-free / opencode-free are filter labels for suggested-models UI;
// the upstream payload is still the standard OpenAI models list.
export const SYNCABLE_MODELS_FETCHER_TYPES = new Set([
  "openai",
  "openrouter-free",
  "opencode-free",
]);

export function resolveModelsUrl(connection) {
  // Per-account override first: custom nodes and Alibaba region hosts carry
  // their own baseUrl (often the full chat URL).
  const configured = connection.providerSpecificData?.baseUrl;
  if (typeof configured === "string" && configured.trim()) {
    return modelsUrlFromBase(configured);
  }
  const provider = REGISTRY.find((entry) => entry.id === connection.provider);
  // modelsFetcher is the declarative models endpoint; transport.validateUrl is
  // the connection-test probe and must NOT drive catalog sync for providers
  // whose auth check is a POST (antigravity) or a chat probe.
  // Skip non-list shapes (e.g. models.dev) — those stay on the static seed.
  const fetcher = provider?.modelsFetcher;
  const url = SYNCABLE_MODELS_FETCHER_TYPES.has(fetcher?.type) && typeof fetcher?.url === "string"
    ? fetcher.url
    : null;
  if (url) return url;
  // Fallback: OpenAI-compatible validateUrl that already points at /models.
  const validateUrl = provider?.transport?.validateUrl;
  if (typeof validateUrl === "string" && /\/models\/?$/i.test(validateUrl.trim())) {
    return validateUrl.trim().replace(/\/$/, "");
  }
  return null;
}

export function getConnectionCatalog(connection) {
  const stored = connection?.modelCatalog;
  if (!stored || typeof stored !== "object") {
    return { models: [], lastSuccessAt: null, lastError: null };
  }
  return {
    models: Array.isArray(stored.models) ? stored.models : [],
    lastSuccessAt: stored.lastSuccessAt || null,
    lastAttemptAt: stored.lastAttemptAt || null,
    lastError: stored.lastError || null,
  };
}

export function catalogStatus(connection) {
  const catalog = getConnectionCatalog(connection);
  if (!catalog.models.length && !catalog.lastSuccessAt) {
    return catalog.lastError ? "error" : "never-synced";
  }
  if (catalog.lastError && !catalog.lastSuccessAt) return "error";
  if (catalog.lastError) return "stale";
  return "ok";
}

export function isConnectionCatalogStale(connection, now = Date.now()) {
  const lastSuccessAt = Date.parse(getConnectionCatalog(connection).lastSuccessAt || "");
  return !Number.isFinite(lastSuccessAt) || now - lastSuccessAt >= DAY_MS;
}

function authHeaders(connection) {
  const provider = REGISTRY.find((entry) => entry.id === connection.provider);
  const headers = { Accept: "application/json" };
  if (provider?.transport?.auth === false || provider?.noAuth) return headers;
  if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
  else if (connection.accessToken) headers.Authorization = `Bearer ${connection.accessToken}`;
  return headers;
}

async function fetchWithRetry(url, { headers }) {
  // fetchPublic re-validates every redirect hop: a validated public URL
  // cannot 30x its way to an internal target, and Bearer credentials are
  // only ever sent to the validated endpoint chain.
  const { fetchPublic } = await import("@/shared/utils/ssrfGuard.js");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const response = await fetchPublic(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) return { response };
      // Auth/permission failures repeat verbatim — retrying burns nothing.
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return { response };
      }
      lastError = new Error(`model listing returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("model listing failed");
}

export async function listConnectionModels(connection) {
  const url = resolveModelsUrl(connection);
  if (!url) {
    return {
      error: `Provider ${connection?.provider || "unknown"} does not support models listing`,
      status: 400,
      models: [],
    };
  }
  try {
    assertPublicUrl(url);
  } catch {
    return { error: "models endpoint is not a public URL", status: 400, models: [] };
  }

  let response;
  try {
    ({ response } = await fetchWithRetry(url, { headers: authHeaders(connection) }));
  } catch (error) {
    return { error: error?.message || "network error", status: 502, models: [] };
  }
  if (!response.ok) {
    return {
      error: `Failed to fetch models: ${response.status}`,
      status: response.status,
      models: [],
    };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { error: "model listing returned invalid JSON", status: 502, models: [] };
  }
  return {
    models: normalizedModels(payload, { providerId: connection.provider }),
  };
}

// ── Sync gating: one chokepoint for the kill switch and for concurrency ─────
//
// docs/MODEL_SYNC_CATALOG.md promises "Disable with CONNECTION_MODEL_SYNC=off".
// The flag governs every sync the app starts on its own initiative — the daily
// scheduler, the first sync fired when a connection is created, the sync after
// a custom→native migration. A sync the user explicitly asked for (dashboard
// "Models" button) is manual and always runs: the flag means "don't spend my
// traffic and account credentials on your own initiative", not "break the
// feature". Enforcing it here instead of at each call site means a future
// automatic trigger is covered the moment it passes { automatic: true }.
export const AUTOMATIC_SYNC_DISABLED_REASON = "automatic model sync disabled (CONNECTION_MODEL_SYNC=off)";

export function isAutomaticModelSyncEnabled() {
  return String(process.env.CONNECTION_MODEL_SYNC || "").trim().toLowerCase() !== "off";
}

// A manual click costs a credentialed GET (3 attempts × 15s of timeout), and
// two overlapping syncs of one connection race on read-compute-write of
// modelCatalog: the last writer wins and can rewind the "missing from N
// consecutive syncs" counters the other sync just advanced. So: concurrent
// calls join the run already in flight (same promise, one fetch), and a repeat
// click within this short cooldown is answered from the run that already
// finished instead of refetching upstream.
export const MANUAL_SYNC_COOLDOWN_MS = 30_000;

const inFlightSyncs = new Map(); // connectionId -> Promise<result>
const lastManualSync = new Map(); // connectionId -> { at, result }

function syncKey(connectionOrId) {
  return typeof connectionOrId === "string" ? connectionOrId : (connectionOrId?.id || null);
}

function rememberManualSync(key, result) {
  // Connections are few; clear-the-ledger keeps this bounded without an
  // eviction policy nobody needs.
  if (lastManualSync.size > 500) lastManualSync.clear();
  lastManualSync.set(key, { at: Date.now(), result });
}

/**
 * @param {object|string} connectionOrId connection row, or its id
 * @param {{ automatic?: boolean, cooldownMs?: number }} [options]
 *   `automatic: true` marks a sync the app triggered itself (scheduler,
 *   creation, migration) — such calls are skipped while
 *   CONNECTION_MODEL_SYNC=off. `cooldownMs > 0` marks a user-facing caller that
 *   wants repeat calls folded into the run that just finished (deduped: true).
 * @returns {Promise<object>} sync result; `{ skipped, disabled, reason }` when
 *   suppressed, `{ ...result, deduped: true }` when folded into a recent one.
 */
export function syncConnectionCatalog(connectionOrId, { automatic = false, cooldownMs = 0 } = {}) {
  const key = syncKey(connectionOrId);

  if (automatic && !isAutomaticModelSyncEnabled()) {
    return Promise.resolve({
      connectionId: key,
      updated: false,
      skipped: true,
      disabled: true,
      reason: AUTOMATIC_SYNC_DISABLED_REASON,
    });
  }

  if (!automatic && key && cooldownMs > 0) {
    const last = lastManualSync.get(key);
    if (last && Date.now() - last.at < cooldownMs) {
      return Promise.resolve({ ...last.result, deduped: true });
    }
  }

  if (!key) return runConnectionCatalogSync(connectionOrId);

  const running = inFlightSyncs.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const result = await runConnectionCatalogSync(connectionOrId);
      if (!automatic && cooldownMs > 0 && result && typeof result === "object") {
        rememberManualSync(key, result);
      }
      return result;
    } finally {
      inFlightSyncs.delete(key);
    }
  })();
  inFlightSyncs.set(key, promise);
  return promise;
}

async function runConnectionCatalogSync(connectionOrId) {
  const connection = typeof connectionOrId === "string"
    ? await getProviderConnectionById(connectionOrId)
    : connectionOrId;
  if (!connection) return { connectionId: connectionOrId, updated: false, error: "Connection not found" };

  const url = resolveModelsUrl(connection);
  if (!url) {
    return { connectionId: connection.id, skipped: true, reason: "provider does not expose a models endpoint" };
  }
  try {
    assertPublicUrl(url);
  } catch {
    return { connectionId: connection.id, skipped: true, reason: "models endpoint is not a public URL" };
  }

  const previous = getConnectionCatalog(connection);
  let response;
  try {
    ({ response } = await fetchWithRetry(url, { headers: authHeaders(connection) }));
  } catch (error) {
    // Network failure: keep the last valid list, record the miss.
    const modelCatalog = { ...previous, lastError: error?.message || "network error", lastAttemptAt: new Date().toISOString() };
    await updateProviderConnection(connection.id, { modelCatalog });
    return { connectionId: connection.id, updated: false, error: modelCatalog.lastError };
  }
  if (!response.ok) {
    const status = `model listing returned HTTP ${response.status}`;
    const modelCatalog = { ...previous, lastError: status, lastAttemptAt: new Date().toISOString() };
    await updateProviderConnection(connection.id, { modelCatalog });
    return { connectionId: connection.id, updated: false, error: status, status: response.status };
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    const modelCatalog = { ...previous, lastError: "model listing returned invalid JSON", lastAttemptAt: new Date().toISOString() };
    await updateProviderConnection(connection.id, { modelCatalog });
    return { connectionId: connection.id, updated: false, error: modelCatalog.lastError };
  }
  const current = normalizedModels(payload, { providerId: connection.provider });
  if (!current.length) {
    // Empty list on a 200 is indistinguishable from an outage — never wipe.
    const modelCatalog = { ...previous, lastError: "model listing returned no usable models", lastAttemptAt: new Date().toISOString() };
    await updateProviderConnection(connection.id, { modelCatalog });
    return { connectionId: connection.id, updated: false, error: modelCatalog.lastError };
  }

  const oldById = new Map((previous.models || []).map((model) => [model.id, model]));
  const currentIds = new Set(current.map((model) => model.id));
  const models = current.map((model) => {
    const old = oldById.get(model.id);
    return {
      ...model,
      // Preserve capability/context/output metadata the provider did not send.
      capabilities: model.capabilities ?? old?.capabilities,
      contextLength: model.contextLength ?? old?.contextLength,
      availability: "available",
      missingSyncs: 0,
    };
  });
  for (const old of previous.models || []) {
    if (currentIds.has(old.id)) continue;
    const missingSyncs = (old.missingSyncs || 0) + 1;
    models.push({
      ...old,
      missingSyncs,
      availability: missingSyncs >= RETRY_AFTER_MISSING ? "unavailable" : "temporarily-absent",
    });
  }

  const modelCatalog = { models, lastSuccessAt: new Date().toISOString(), lastError: null };
  await updateProviderConnection(connection.id, { modelCatalog });
  return {
    connectionId: connection.id,
    updated: true,
    available: current.length,
    unavailable: models.filter((m) => m.availability === "unavailable").length,
    pending: models.filter((m) => m.availability === "temporarily-absent").length,
  };
}

export async function syncDueConnectionCatalogs({ force = false } = {}) {
  const connections = await getProviderConnections({ isActive: true });
  const results = [];
  for (const connection of connections) {
    // OAuth providers whose token refreshes on use sync lazily; only sync
    // connections whose endpoint is a plain GET with a stored credential.
    if (force || isConnectionCatalogStale(connection)) {
      results.push(await syncConnectionCatalog(connection, { automatic: true }));
    }
  }
  return results;
}
