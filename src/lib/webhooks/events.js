// Operational webhook correlation context and terminal event owner.
//
// Public contract (consumed by dispatcher/streaming wiring in later tasks):
//   setWebhookSink(sink|null)            - DI seam; sink(event) => void|Promise<void>
//   runWithWebhookContext(opts, fn)      - root scope {requestId, modality}; returns fn() unchanged
//   getWebhookContext()                  - snapshot {requestId, modality, admitted, finalized, isRoot}
//   markWebhookAdmitted()                - explicit admission marker
//   captureWebhookFinalizer()            - finalize(outcome) bound to the calling scope's ownership
//   finalizeWebhookRequest(outcome)      - once-only terminal for the current root
//   emitWebhookEvent(type, data)         - transient emit; request.failed requires root+admission+once
//
// `emitted: true` means the envelope was handed to the sink, not that it was
// persisted or delivered. Durability acknowledgement belongs to the outbox
// writer wired in a later task. Sink failures never affect the request.
//
// No DB, no engine import, no stream/body buffering.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { WEBHOOK_EVENT_CATALOG, WEBHOOK_SCHEMA_VERSION } from "@/shared/constants/webhooks.js";
import { validateEventEnvelope } from "./validation.js";

const storage = new AsyncLocalStorage();
let sink = null;

const FINAL_EVENT_TYPE = "request.failed";
const DATA_KEYS = Object.freeze([
  "requestId", "modality", "provider", "model",
  "connectionId", "statusCode", "errorClass", "partialResponse",
]);

export function setWebhookSink(next) {
  sink = typeof next === "function" ? next : null;
  return sink;
}

export function hasWebhookSink() {
  return sink !== null;
}

export function runWithWebhookContext(options = {}, fn) {
  if (typeof fn !== "function") throw new TypeError("runWithWebhookContext requires a function");
  const active = storage.getStore();
  if (active) {
    return storage.run(
      { requestId: active.root.requestId, modality: active.modality, isRoot: false, root: active.root },
      fn,
    );
  }
  const requestId = typeof options.requestId === "string" && options.requestId.length > 0
    ? options.requestId : null;
  const modality = typeof options.modality === "string" ? options.modality : null;
  const root = { requestId, modality, admitted: false, finalized: false };
  return storage.run({ requestId, modality, isRoot: true, root }, fn);
}

export function getWebhookContext() {
  const store = storage.getStore();
  if (!store) return null;
  return {
    requestId: store.root.requestId,
    modality: store.modality,
    admitted: store.root.admitted === true,
    finalized: store.root.finalized === true,
    isRoot: store.isRoot === true,
  };
}

export function markWebhookAdmitted() {
  const store = storage.getStore();
  if (!store) return false;
  store.root.admitted = true;
  return true;
}

export function captureWebhookFinalizer() {
  const store = storage.getStore();
  if (!store) return () => ({ emitted: false, reason: "no_context" });
  return (outcome = {}) => finalizeFor(store, outcome);
}

export function finalizeWebhookRequest(outcome = {}) {
  const store = storage.getStore();
  if (!store) return { emitted: false, reason: "no_context" };
  return finalizeFor(store, outcome);
}

export function emitWebhookEvent(type, data) {
  const store = storage.getStore();
  const isFinal = type === FINAL_EVENT_TYPE;
  if (isFinal) {
    if (!store || store.isRoot !== true) return { ok: false, emitted: false, reason: "not_root" };
    if (store.root.admitted !== true) return { ok: false, emitted: false, reason: "not_admitted" };
    if (store.root.finalized === true) return { ok: false, emitted: false, reason: "duplicate" };
  }
  const sanitized = sanitizeData(data, store ? store.root.requestId : null);
  const built = buildEnvelope(type, sanitized);
  if (!built.ok) return { ok: false, emitted: false, reason: built.reason, errors: built.errors };
  if (isFinal) store.root.finalized = true;
  const emitted = dispatch(built.envelope);
  return { ok: true, emitted, reason: emitted ? "emitted" : "no_sink" };
}

function finalizeFor(store, outcome) {
  if (store.isRoot !== true) return { emitted: false, reason: "not_root" };
  const root = store.root;
  if (root.finalized === true) return { emitted: false, reason: "duplicate" };

  const kind = outcome && outcome.outcome;
  if (kind === "completed") {
    root.finalized = true;
    return { emitted: false, reason: "completed" };
  }
  if (kind === "client_cancelled") {
    root.finalized = true;
    return { emitted: false, reason: "client_cancelled" };
  }
  if (kind !== "failed") return { emitted: false, reason: "invalid_outcome" };
  if (root.admitted !== true) return { emitted: false, reason: "not_admitted" };

  const sanitized = sanitizeData({
    statusCode: outcome.statusCode,
    errorClass: outcome.errorClass,
    partialResponse: outcome.partialResponse,
    provider: outcome.provider,
    model: outcome.model,
    connectionId: outcome.connectionId,
    modality: outcome.modality,
  }, root.requestId);
  const built = buildEnvelope(FINAL_EVENT_TYPE, sanitized);
  root.finalized = true;
  if (!built.ok) return { emitted: false, reason: built.reason, errors: built.errors };
  const emitted = dispatch(built.envelope);
  return { emitted, reason: emitted ? "emitted" : "no_sink" };
}

function sanitizeData(input, contextRequestId) {
  const out = {};
  if (input && typeof input === "object") {
    for (const key of DATA_KEYS) {
      if (key === "requestId") continue;
      const value = input[key];
      if (value === undefined) continue;
      out[key] = value;
    }
  }
  if (typeof contextRequestId === "string" && contextRequestId.length > 0) out.requestId = contextRequestId;
  return out;
}

function buildEnvelope(type, data) {
  const catalogEntry = typeof type === "string" && Object.prototype.hasOwnProperty.call(WEBHOOK_EVENT_CATALOG, type)
    ? WEBHOOK_EVENT_CATALOG[type] : null;
  if (!catalogEntry) return { ok: false, reason: "unknown_event", errors: [{ field: "type", code: "unknown_event" }] };
  const envelope = {
    id: randomUUID(),
    type,
    schema_version: WEBHOOK_SCHEMA_VERSION,
    occurred_at: new Date().toISOString(),
    severity: catalogEntry.severity,
    data,
  };
  const validated = validateEventEnvelope(envelope);
  if (!validated.ok) return { ok: false, reason: "invalid_envelope", errors: validated.errors };
  return { ok: true, envelope: validated.value };
}

function dispatch(envelope) {
  if (!sink) return false;
  try {
    const result = sink(envelope);
    if (result && typeof result.then === "function") result.then(undefined, () => {});
  } catch {
    // A sink failure must never alter the proxy request result.
  }
  return true;
}
