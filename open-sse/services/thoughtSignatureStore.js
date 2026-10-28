import { makeKv } from "../../src/lib/db/helpers/kvStore.js";

const MAX_SIGNATURES = 2000;
const MAX_PERSISTED_SIGNATURES = 10_000;
const MEMORY_TTL_MS = 1000 * 60 * 60; // 1 hour
const PERSISTED_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const SCOPE = "gemini_thought_signatures";

const signatureKv = makeKv(SCOPE);
const memorySignatures = new Map();
let pruneCounter = 0;

/**
 * Model family that produced / will consume a signature. Antigravity serves Gemini and Claude
 * models behind the same API, and each backend only accepts its own signatures: a Claude
 * signature replayed to Gemini fails with 400 "Corrupted thought signature." (and vice versa).
 */
export function signatureFamily(model) {
  const m = typeof model === "string" ? model.toLowerCase() : "";
  if (!m) return null;
  if (m.includes("claude")) return "claude";
  if (m.includes("gemini")) return "gemini";
  return m;
}

// Entries stored before families were recorded (no `family`) stay usable for any model.
function isCompatible(entry, family) {
  return !entry.family || !family || entry.family === family;
}

function pruneMemoryExpired() {
  const now = Date.now();
  for (const [key, value] of memorySignatures.entries()) {
    if (value.expiresAt <= now) {
      memorySignatures.delete(key);
    }
  }

  while (memorySignatures.size > MAX_SIGNATURES) {
    const oldestKey = memorySignatures.keys().next().value;
    if (!oldestKey) break;
    memorySignatures.delete(oldestKey);
  }
}

async function maybePrunePersisted() {
  pruneCounter++;
  if (pruneCounter % 100 !== 0) return;

  try {
    const all = await signatureKv.getAll();
    const keys = Object.keys(all);
    const now = Date.now();
    const expiredKeys = [];
    const valid = [];

    for (const k of keys) {
      const entry = all[k];
      if (!entry || typeof entry.signature !== "string" || (entry.expiresAt && entry.expiresAt <= now)) {
        expiredKeys.push(k);
      } else {
        valid.push({ key: k, createdAt: entry.createdAt || 0 });
      }
    }

    for (const k of expiredKeys) {
      await signatureKv.remove(k).catch(() => {});
    }

    if (valid.length > MAX_PERSISTED_SIGNATURES) {
      valid.sort((a, b) => b.createdAt - a.createdAt);
      const toRemove = valid.slice(MAX_PERSISTED_SIGNATURES);
      for (const item of toRemove) {
        await signatureKv.remove(item.key).catch(() => {});
      }
    }
  } catch {
    // Fail-open
  }
}

/**
 * Store a thought signature for a tool_call_id with optional sessionId namespace (RAM + SQLite async).
 * `model` is the model that produced the signature; lookups for another model family skip it.
 */
export function storeGeminiThoughtSignature(toolCallId, signature, sessionId = null, model = null) {
  if (typeof toolCallId !== "string" || !toolCallId) return;
  if (typeof signature !== "string" || !signature) return;

  const now = Date.now();
  const family = signatureFamily(model);
  pruneMemoryExpired();

  const keys = [];
  if (sessionId && typeof sessionId === "string") {
    keys.push(`${sessionId}:${toolCallId}`);
  }
  keys.push(toolCallId);

  for (const k of keys) {
    memorySignatures.set(k, {
      signature,
      family,
      expiresAt: now + MEMORY_TTL_MS,
    });

    // Async persist to SQLite kv table without blocking
    signatureKv.set(k, {
      signature,
      family,
      createdAt: now,
      expiresAt: now + PERSISTED_TTL_MS,
    }).catch(() => {});
  }

  maybePrunePersisted().catch(() => {});
}

/**
 * Retrieve a thought signature by tool_call_id (RAM first, then SQLite fallback).
 * `model` is the target model; signatures produced by another model family are ignored.
 */
export async function getGeminiThoughtSignature(toolCallId, sessionId = null, model = null) {
  if (typeof toolCallId !== "string" || !toolCallId) return null;

  const family = signatureFamily(model);
  pruneMemoryExpired();

  if (sessionId && typeof sessionId === "string") {
    const sessionKey = `${sessionId}:${toolCallId}`;
    const sessionEntry = memorySignatures.get(sessionKey);
    if (sessionEntry && sessionEntry.expiresAt > Date.now() && isCompatible(sessionEntry, family)) {
      return sessionEntry.signature;
    }
  }

  const entry = memorySignatures.get(toolCallId);
  if (entry && entry.expiresAt > Date.now() && isCompatible(entry, family)) {
    return entry.signature;
  }

  try {
    if (sessionId && typeof sessionId === "string") {
      const sessionKey = `${sessionId}:${toolCallId}`;
      const sessionRow = await signatureKv.get(sessionKey);
      if (sessionRow && typeof sessionRow.signature === "string" && (!sessionRow.expiresAt || sessionRow.expiresAt > Date.now()) && isCompatible(sessionRow, family)) {
        memorySignatures.set(sessionKey, {
          signature: sessionRow.signature,
          family: sessionRow.family || null,
          expiresAt: Date.now() + MEMORY_TTL_MS,
        });
        return sessionRow.signature;
      }
    }

    const row = await signatureKv.get(toolCallId);
    if (row && typeof row.signature === "string") {
      if (row.expiresAt && row.expiresAt <= Date.now()) {
        signatureKv.remove(toolCallId).catch(() => {});
        return null;
      }
      if (!isCompatible(row, family)) return null;
      memorySignatures.set(toolCallId, {
        signature: row.signature,
        family: row.family || null,
        expiresAt: Date.now() + MEMORY_TTL_MS,
      });
      return row.signature;
    }
  } catch {
    // Fail-open
  }

  return null;
}

/**
 * Synchronous get from RAM cache only (for sync translators).
 * `model` is the target model; signatures produced by another model family are ignored.
 */
export function getGeminiThoughtSignatureSync(toolCallId, sessionId = null, model = null) {
  if (typeof toolCallId !== "string" || !toolCallId) return null;
  const family = signatureFamily(model);
  pruneMemoryExpired();

  if (sessionId && typeof sessionId === "string") {
    const sessionKey = `${sessionId}:${toolCallId}`;
    const sessionEntry = memorySignatures.get(sessionKey);
    if (sessionEntry && sessionEntry.expiresAt > Date.now() && isCompatible(sessionEntry, family)) {
      return sessionEntry.signature;
    }
  }

  const entry = memorySignatures.get(toolCallId);
  if (entry && entry.expiresAt > Date.now() && isCompatible(entry, family)) {
    return entry.signature;
  }
  return null;
}
