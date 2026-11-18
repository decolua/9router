import { getAdapter } from "./db/driver.js";

const RETENTION_MS = 60 * 60 * 1000;
const RETENTION_EVENT_LIMIT = 200;
// ponytail: process-local debugging only; use a shared TTL store if multi-process capture is needed.
const state = globalThis.__promptRetention ??= { entries: new Map(), generations: new Map(), contexts: new WeakMap(), events: [] };

/**
 * Record a consent change for the prompt-retention debugging option.
 * Newest first, capped ring; also printed to the server log. Attribution
 * uses the key name and masked key — never the raw key.
 */
export function recordRetentionChange(keyId, keyName, maskedKey, enabled, source = "dashboard") {
  const event = {
    at: new Date().toISOString(),
    keyId,
    keyName: keyName || null,
    maskedKey: maskedKey || null,
    enabled: enabled === true,
    source,
  };
  state.events.unshift(event);
  if (state.events.length > RETENTION_EVENT_LIMIT) state.events.length = RETENTION_EVENT_LIMIT;
  console.log(`[PromptRetention] ${event.enabled ? "ENABLED" : "DISABLED"} for key "${event.keyName ?? keyId}" (${event.maskedKey ?? "unknown key"}) via ${event.source} at ${event.at}`);
  return event;
}

export function getRetentionEvents({ keyId, limit = 50 } = {}) {
  let events = state.events;
  if (keyId !== undefined && keyId !== null) events = events.filter((e) => e.keyId === keyId);
  return events.slice(0, Math.max(1, Math.min(limit, RETENTION_EVENT_LIMIT)));
}

function removeEntry(id) {
  clearTimeout(state.entries.get(id)?.timer);
  state.entries.delete(id);
}

export function purgeRetainedPrompts(keyId) {
  for (const [id, entry] of state.entries) {
    if (keyId === undefined || entry.keyId === keyId) removeEntry(id);
  }
  if (keyId === undefined) state.generations.clear();
  else state.generations.delete(keyId);
}

function permitted(db, keyId) {
  const row = db.get("SELECT isActive, promptRetentionEnabled FROM apiKeys WHERE id = ?", [keyId]);
  return (row?.isActive === 1 || row?.isActive === true)
    && (row.promptRetentionEnabled === 1 || row.promptRetentionEnabled === true);
}

export async function createPromptRetentionContext(apiKey) {
  if (!apiKey) return null;
  const db = await getAdapter();
  const row = db.get("SELECT id, name, key FROM apiKeys WHERE key = ?", [apiKey]);
  if (!row || !permitted(db, row.id)) return null;
  if (!state.generations.has(row.id)) state.generations.set(row.id, {});
  const context = {};
  // Kept alongside the payload for attribution: masked key + key name only — never the raw key.
  state.contexts.set(context, { db, keyId: row.id, keyName: row.name || null, apiKeyMasked: maskKeyForDisplay(row.key), generation: state.generations.get(row.id), expiresAt: Date.now() + RETENTION_MS });
  return context;
}

export function maskKeyForDisplay(key) {
  if (typeof key !== "string" || !key) return null;
  return key.length <= 12 ? key.charAt(0) + "***" : key.slice(0, 8) + "***" + key.slice(-4);
}

export function retainPromptData(id, context, payload, maxRecords) {
  const consent = context && state.contexts.get(context);
  if (!consent || consent.expiresAt <= Date.now()
    || consent.generation !== state.generations.get(consent.keyId)
    || !permitted(consent.db, consent.keyId)) return;
  removeEntry(id);
  const timer = setTimeout(() => removeEntry(id), consent.expiresAt - Date.now());
  timer.unref?.();
  state.entries.set(id, { ...consent, payload: JSON.stringify(payload), timer });
  const limit = Number.isSafeInteger(maxRecords) && maxRecords > 0 ? maxRecords : 200;
  while (state.entries.size > limit) removeEntry(state.entries.keys().next().value);
}

// Snapshot the request body BEFORE any mutation (thinking injection, RTK
// compression, fingerprint tools, provider system rewrites) can touch it.
// Consent-gated: only opted-in keys pay the structured-clone cost. The
// snapshot rides on the context's WeakMap cell, so revocation/expiry/purge
// drops it with everything else.
export function snapshotOriginalBody(context, body) {
  const consent = context && state.contexts.get(context);
  if (!consent) return;
  try { consent.originalBody = structuredClone(body); } catch { consent.originalBody = null; }
}

export function getOriginalBody(context) {
  const consent = context && state.contexts.get(context);
  return consent?.originalBody ?? null;
}

export function getRetainedPromptData(id) {
  const entry = state.entries.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now() || !permitted(entry.db, entry.keyId)) {
    removeEntry(id);
    return null;
  }
  return {
    ...JSON.parse(entry.payload),
    promptRetentionExpiresAt: new Date(entry.expiresAt).toISOString(),
    requestedByKey: { name: entry.keyName, maskedKey: entry.apiKeyMasked },
  };
}
