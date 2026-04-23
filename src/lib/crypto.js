/**
 * Simple AES-256-GCM encryption for storing sensitive credentials locally.
 *
 * Since 9Router is a local-first app (data lives in a JSON file on the user's
 * machine), this provides defense-in-depth — the credentials are not stored in
 * plaintext even though the DB itself is already local.
 *
 * Key derivation:
 *   1. If ENCRYPTION_SECRET env var is set, use it as the passphrase.
 *   2. Otherwise, derive a deterministic key from os.hostname() so the key
 *      is stable across restarts but unique per machine.
 */

import crypto from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = "9router-credential-salt-v1";

/**
 * Derive a 256-bit encryption key via PBKDF2.
 * Cached after first call for performance.
 */
let _cachedKey = null;
function getEncryptionKey() {
  if (_cachedKey) return _cachedKey;

  const passphrase = process.env.ENCRYPTION_SECRET || `9router-${os.hostname()}`;
  _cachedKey = crypto.pbkdf2Sync(passphrase, SALT, 100_000, 32, "sha256");
  return _cachedKey;
}

/**
 * Encrypt a plain object into a base64 string.
 * @param {object} plainObj - Object to encrypt (will be JSON-stringified)
 * @returns {string} Base64-encoded ciphertext (iv + authTag + encrypted)
 */
export function encryptCredentials(plainObj) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(plainObj);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (16) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64 ciphertext string back into the original object.
 * @param {string} ciphertext - Base64 string produced by encryptCredentials
 * @returns {object|null} Decrypted object, or null if decryption fails
 */
export function decryptCredentials(ciphertext) {
  try {
    const key = getEncryptionKey();
    const packed = Buffer.from(ciphertext, "base64");

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}
