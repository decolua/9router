import { randomUUID } from "node:crypto";

const MAX_RECORDS = 5000;
const RETENTION_MS = 15 * 60 * 1000;
const FLUSH_MS = 100;

const state = globalThis.__9routerLiveRoutes || (globalThis.__9routerLiveRoutes = {
  records: [], listeners: new Set(), pending: [], timer: null, staleTimer: null,
});

function now() { return Date.now(); }

function cleanClient(client) {
  return {
    name: client?.name || "Unknown client",
    version: client?.version || null,
  };
}

function emit(event) {
  state.pending.push(event);
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    const batch = state.pending.splice(0);
    for (const listener of state.listeners) {
      try { listener(batch); } catch { /* listener owns its lifecycle */ }
    }
  }, FLUSH_MS);
  state.timer.unref?.();
}

function prune(timestamp = now()) {
  const cutoff = timestamp - RETENTION_MS;
  for (const record of state.records) {
    if (record.status === "running" && record.startedAt < cutoff) {
      record.status = "aborted";
      record.endedAt = cutoff;
      record.latencyMs = Math.max(0, cutoff - record.startedAt);
      emit({ type: "end", record: { ...record } });
    }
  }
  state.records = state.records.filter(record => (record.endedAt || timestamp) >= cutoff);
  if (state.records.length > MAX_RECORDS) state.records.splice(0, state.records.length - MAX_RECORDS);
}

if (!state.staleTimer) {
  state.staleTimer = setInterval(() => prune(), 30_000);
  state.staleTimer.unref?.();
}

export function startLiveRoute(trace, request) {
  prune();
  const record = {
    id: trace.requestId || randomUUID(),
    startedAt: trace.startedAt || trace.started || now(),
    endedAt: null,
    status: "running",
    provider: null,
    connectionId: null,
    model: null,
    requestedModel: trace.requestedModel || null,
    combo: trace.combo || null,
    endpoint: trace.endpoint || (request ? new URL(request.url).pathname : null),
    client: cleanClient(trace.client),
    ip: trace.ip || "unknown",
    sessionId: trace.sessionId || null,
    keyId: null,
    keyName: null,
    attempts: 0,
    fallbacks: 0,
    latencyMs: null,
    ttftMs: null,
    inputTokens: null,
    outputTokens: null,
  };
  state.records.push(record);
  trace.liveRouteId = record.id;
  emit({ type: "start", record: { ...record } });
  return record;
}

function find(traceOrId) {
  const id = typeof traceOrId === "string" ? traceOrId : traceOrId?.liveRouteId || traceOrId?.requestId;
  return state.records.find(record => record.id === id) || null;
}

export function updateLiveRoute(traceOrId, patch = {}) {
  const record = find(traceOrId);
  if (!record || record.status !== "running") return record;
  Object.assign(record, patch);
  if (patch.client) record.client = cleanClient(patch.client);
  emit({ type: "update", record: { ...record } });
  return record;
}

export function noteLiveAttempt(traceOrId, provider, model, connectionId) {
  const record = find(traceOrId);
  if (!record) return null;
  const changed = record.attempts > 0 && (record.provider !== provider || record.model !== model || record.connectionId !== connectionId);
  record.attempts += 1;
  if (changed) record.fallbacks += 1;
  Object.assign(record, { provider, model, connectionId });
  emit({ type: "update", record: { ...record } });
  return record;
}

export function endLiveRoute(traceOrId, entry = {}) {
  const record = find(traceOrId);
  if (!record || record.status !== "running") return record;
  const tokens = entry.tokens || {};
  const status = entry.status === "aborted" || entry.status === "cancelled" ? "aborted"
    : entry.status === "error" || entry.status === "failed" ? "error" : "ok";
  record.status = status;
  record.endedAt = entry.endedAt || now();
  record.latencyMs = entry.latencyMs ?? Math.max(0, record.endedAt - record.startedAt);
  record.ttftMs = entry.ttftMs ?? record.ttftMs ?? null;
  record.inputTokens = entry.inputTokens ?? tokens.input_tokens ?? tokens.prompt_tokens ?? null;
  record.outputTokens = entry.outputTokens ?? tokens.output_tokens ?? tokens.completion_tokens ?? null;
  record.attempts = entry.meta?.attempts ?? record.attempts;
  record.fallbacks = entry.meta?.fallbacks ?? record.fallbacks;
  Object.assign(record, {
    provider: entry.provider ?? record.provider,
    model: entry.model ?? record.model,
    connectionId: entry.connectionId ?? record.connectionId,
  });
  emit({ type: "end", record: { ...record } });
  return record;
}

export function subscribeLiveRoutes(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function getLiveRouteListenerCount() {
  return state.listeners.size;
}

export function getLiveRoutesSnapshot(timestamp = now()) {
  prune(timestamp);
  return state.records.map(record => ({ ...record, client: { ...record.client } }));
}

export function resetLiveRoutes() {
  state.records.length = 0;
  state.pending.length = 0;
}

export const LIVE_ROUTES_LIMITS = { MAX_RECORDS, RETENTION_MS };
