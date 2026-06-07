// Master key loader for at-rest encryption.
//
// Source: MASTER_KEY env var, base64-encoded, must decode to exactly 32 bytes (AES-256).
// Generate with: openssl rand -base64 32
//
// Behavior:
//   - First call reads & validates the env var, then caches the key buffer in module scope.
//   - Validation: base64 must decode cleanly; result must be exactly 32 bytes; not all-zero.
//   - Any failure throws a descriptive error — fail-closed so misconfig is never silent.
//   - isMasterKeyConfigured() returns boolean without throwing (used by boot guard).
//
// Key fingerprint (sha256("ebrouter-mk-fp:" || keyBytes), first 16 hex chars) is exported
// for migration to stamp into _meta on first encryption — boot guard compares stored vs
// current fingerprint to detect "wrong key" before any decryption garbage flows downstream.

import crypto from "node:crypto";

const KEY_LEN = 32;
const FINGERPRINT_DOMAIN = "ebrouter-mk-fp:";

let cachedKey = null;
let cachedFingerprint = null;

function loadFromEnv() {
  const raw = process.env.MASTER_KEY;
  if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("[crypto] MASTER_KEY env var is not set. Generate one with: openssl rand -base64 32");
  }
  let key;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch (e) {
    throw new Error(`[crypto] MASTER_KEY is not valid base64: ${e.message}`);
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`[crypto] MASTER_KEY must decode to ${KEY_LEN} bytes (AES-256), got ${key.length}`);
  }
  if (key.every((b) => b === 0)) {
    throw new Error("[crypto] MASTER_KEY decodes to all zeroes — refusing to use a null key");
  }
  return key;
}

export function getMasterKey() {
  if (cachedKey) return cachedKey;
  cachedKey = loadFromEnv();
  return cachedKey;
}

export function isMasterKeyConfigured() {
  if (cachedKey) return true;
  try {
    cachedKey = loadFromEnv();
    return true;
  } catch {
    return false;
  }
}

export function getKeyFingerprint() {
  if (cachedFingerprint) return cachedFingerprint;
  const key = getMasterKey();
  const h = crypto.createHash("sha256");
  h.update(FINGERPRINT_DOMAIN);
  h.update(key);
  cachedFingerprint = h.digest("hex").slice(0, 16);
  return cachedFingerprint;
}

// Test-only: clear cache so a fresh process-env read happens on next call.
// Not exported via the public barrel; only the tests import this directly.
export function _resetCacheForTests() {
  cachedKey = null;
  cachedFingerprint = null;
}
