// Drop-in replacement for parseJson/stringifyJson for columns that must be encrypted at rest.
//
// Tolerates mixed plaintext / encrypted rows during the rolling migration window:
//   - Read path: if value is `enc:v1:…` → decrypt then JSON.parse. Otherwise treat as legacy
//     plaintext JSON and parse directly. This means an unencrypted row read AFTER the feature
//     is enabled will be rewritten as encrypted on the next save (since stringify always
//     encrypts).
//   - Write path: always encrypts. There is no opt-out — repos that want plaintext should
//     keep using parseJson/stringifyJson.
//
// Failure modes:
//   - If MASTER_KEY is unset and we are asked to read an encrypted row → throws. Caller
//     (boot guard) should have refused to start the process; if we got here it's a bug.
//   - If MASTER_KEY is set but produces a decryption failure → throws (auth tag mismatch).
//     Surfaced as "decryption failed: data is tampered or key is wrong" with no specifics.

import { parseJson, stringifyJson } from "./jsonCol.js";
import { encrypt, decrypt, isEncrypted } from "../../crypto/envelope.js";
import { getMasterKey } from "../../crypto/masterKey.js";

export function parseEncryptedJson(stored, fallback = null) {
  if (stored == null) return fallback;
  if (typeof stored !== "string") return stored;
  if (!isEncrypted(stored)) return parseJson(stored, fallback);

  const key = getMasterKey();
  const plaintext = decrypt(stored, key);
  return parseJson(plaintext, fallback);
}

export function stringifyEncryptedJson(value) {
  const plain = stringifyJson(value);
  const key = getMasterKey();
  return encrypt(plain, key);
}

// Plain-string variants — for columns that aren't JSON-shaped (e.g. apiKeys.key)
export function decryptString(stored) {
  if (stored == null) return stored;
  if (typeof stored !== "string") return stored;
  if (!isEncrypted(stored)) return stored;
  const key = getMasterKey();
  return decrypt(stored, key);
}

export function encryptString(value) {
  if (value == null) return value;
  const key = getMasterKey();
  return encrypt(String(value), key);
}
