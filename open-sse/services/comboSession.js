import { MAX_STICKY_SESSIONS, STICKY_SESSION_TTL_MS } from "../config/sessionAffinity.js";

const sessions = new Map();
const pending = new Map();
const keyFor = (combo, session) => JSON.stringify([combo, session]);

export function getStickyComboRoute(combo, session, models, fingerprint = null) {
  if (!combo || !session || !Array.isArray(models)) return null;
  const key = keyFor(combo, session);
  const entry = sessions.get(key);
  if (!entry) return null;
  if (Date.now() - entry.lastUsed > STICKY_SESSION_TTL_MS || !models.includes(entry.model)
    || (entry.fingerprint && fingerprint && entry.fingerprint !== fingerprint)) {
    sessions.delete(key);
    return null;
  }
  entry.lastUsed = Date.now();
  return entry;
}

export function getStickyComboModel(combo, session, models) {
  return getStickyComboRoute(combo, session, models)?.model || null;
}

export function setStickyComboModel(combo, session, model, target = null, fingerprint = null) {
  if (!combo || !session || !model) return;
  pruneStickyComboSessions();
  sessions.set(keyFor(combo, session), { model, target, fingerprint, lastUsed: Date.now() });
}

export function clearStickyComboSession(combo, session = null) {
  if (!combo) return sessions.clear();
  if (session) return sessions.delete(keyFor(combo, session));
  for (const key of sessions.keys()) if (JSON.parse(key)[0] === combo) sessions.delete(key);
}

export function pruneStickyComboSessions() {
  if (sessions.size < MAX_STICKY_SESSIONS) return;
  const now = Date.now();
  for (const [key, entry] of sessions) if (now - entry.lastUsed > STICKY_SESSION_TTL_MS) sessions.delete(key);
  if (sessions.size >= MAX_STICKY_SESSIONS) {
    const oldest = [...sessions].sort((a, b) => a[1].lastUsed - b[1].lastUsed).slice(0, Math.max(1, Math.floor(MAX_STICKY_SESSIONS / 4)));
    for (const [key] of oldest) sessions.delete(key);
  }
}

// Lock only until dispatch/peek completes, never for the lifetime of an SSE stream.
export async function withComboSessionLock(combo, session, run) {
  const key = keyFor(combo, session);
  const previous = pending.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  pending.set(key, current);
  await previous;
  try { return await run(); }
  finally {
    release();
    if (pending.get(key) === current) pending.delete(key);
  }
}

export function resetStickyComboStore() { sessions.clear(); }
