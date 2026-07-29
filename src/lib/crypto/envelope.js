// AES-256-GCM envelope encryption for at-rest column values.
//
// Envelope format (UTF-8 string):
//   enc:v1:<base64-nonce>:<base64-tag>:<base64-ciphertext>
//
// - v1 is the format version. New formats may be added (v2…); decrypt() dispatches by version.
// - Nonce: 12 random bytes per encryption (GCM standard). Reusing a nonce with the same key
//   destroys confidentiality, so we never derive it deterministically — always crypto.randomBytes.
// - Tag: 16-byte GCM auth tag; tampering or wrong key → decrypt throws.
// - Ciphertext: raw AES-256-GCM output, not padded.
//
// Helpers:
//   - encrypt(plaintext, key)         → envelope string
//   - decrypt(envelope, key)          → plaintext (throws on tamper / wrong key / bad format)
//   - isEncrypted(s)                  → boolean
//   - tryDecrypt(s, key)              → plaintext if encrypted, original string otherwise
//                                       (lets repos handle mixed plaintext/encrypted rows during
//                                       the rolling migration window)

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const NONCE_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:v1:";

export function isEncrypted(s) {
  return typeof s === "string" && s.startsWith(PREFIX);
}

export function encrypt(plaintext, key) {
  if (plaintext == null) return plaintext;
  if (typeof plaintext !== "string") {
    throw new TypeError(`[crypto] encrypt expects string, got ${typeof plaintext}`);
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("[crypto] encrypt requires a 32-byte key buffer");
  }

  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${nonce.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(envelope, key) {
  if (envelope == null) return envelope;
  if (typeof envelope !== "string") {
    throw new TypeError(`[crypto] decrypt expects string, got ${typeof envelope}`);
  }
  if (!envelope.startsWith(PREFIX)) {
    throw new Error("[crypto] decrypt called on non-encrypted value (missing enc:v1: prefix)");
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("[crypto] decrypt requires a 32-byte key buffer");
  }

  const parts = envelope.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("[crypto] malformed envelope: expected nonce:tag:ciphertext");
  }
  const [nonceB64, tagB64, ctB64] = parts;
  const nonce = Buffer.from(nonceB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");

  if (nonce.length !== NONCE_LEN) throw new Error(`[crypto] bad nonce length: ${nonce.length}`);
  if (tag.length !== TAG_LEN) throw new Error(`[crypto] bad tag length: ${tag.length}`);

  const decipher = crypto.createDecipheriv(ALGO, key, nonce);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch (e) {
    // GCM auth failure → tampered, wrong key, or corruption. Don't leak which.
    throw new Error("[crypto] decryption failed: data is tampered or key is wrong");
  }
}

export function tryDecrypt(s, key) {
  if (!isEncrypted(s)) return s;
  return decrypt(s, key);
}
