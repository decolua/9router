import crypto from "crypto";
import { XIAOMI_MIMO_CONFIG } from "../constants/oauth.js";

// ───────────────────────────────────────────────────────────────────────────
// Xiaomi MiMo OAuth helpers
// Custom ECDH + AES-256-GCM encrypted-callback flow (NOT standard OAuth2).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Generate an X25519 keypair for the OAuth handshake.
 * @returns {{ publicKey: string, privateKeyDer: Buffer }}
 *   publicKey     — base64 SPKI (for the `pk` URL param)
 *   privateKeyDer — PKCS8 DER Buffer (for ECDH later)
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");

  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  // SPKI for X25519 is 44 bytes; the raw 32-byte key is the last 32 bytes.
  // But the platform expects the full base64 SPKI — pass as-is.
  const publicKeyB64 = publicKeyDer.toString("base64");

  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs8" });

  return { publicKey: publicKeyB64, privateKeyDer };
}

/**
 * Decrypt the `u` query parameter from the Xiaomi OAuth callback.
 *
 * Wire format (base64-decoded):
 *   bytes 0..11   — 12-byte AES-GCM nonce
 *   bytes 12..43  — 32-byte ephemeral public key (raw X25519)
 *   bytes 44..n-16 — ciphertext
 *   last 16 bytes  — GCM auth tag
 *
 * Key derivation: SHA256(ECDH(clientPrivateKey, ephemeralPublicKey))
 *
 * @param {Buffer} privateKeyDer — PKCS8 DER private key from generateKeyPair()
 * @param {string} encryptedB64  — the `u` query param value (base64)
 * @returns {{ uid: string, sk: string, url?: string }}
 */
export function decryptCallback(privateKeyDer, encryptedB64) {
  const raw = Buffer.from(encryptedB64, "base64");

  if (raw.length < 12 + 32 + 16 + 1) {
    throw new Error(`Encrypted payload too short: ${raw.length} bytes`);
  }

  const nonce = raw.subarray(0, 12);
  const ephemeralPubRaw = raw.subarray(12, 44);
  const ciphertextAndTag = raw.subarray(44);
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - 16);
  const ciphertext = ciphertextAndTag.subarray(0, ciphertextAndTag.length - 16);

  // Reconstruct the ephemeral public key as SPKI DER for Node crypto.
  // X25519 SPKI prefix: 302a300506032b656e032100
  const ephemeralPub = crypto.createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      ephemeralPubRaw,
    ]),
    format: "der",
    type: "spki",
  });

  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });

  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey: ephemeralPub });
  const derivedKey = crypto.createHash("sha256").update(sharedSecret).digest();

  const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const parsed = JSON.parse(decrypted.toString("utf-8"));

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Decrypted payload is not a valid object");
  }

  return {
    uid: parsed.uid || null,
    sk: parsed.sk || null,
    url: parsed.url || XIAOMI_MIMO_CONFIG.defaultBaseUrl,
  };
}

/**
 * Build the browser authorization URL.
 * @param {string} publicKey — base64 SPKI from generateKeyPair()
 * @param {string} redirectUri — e.g. http://localhost:12345/
 * @param {string} [keyName] — optional stable key name
 * @returns {string}
 */
export function buildAuthorizeUrl(publicKey, redirectUri, keyName) {
  const params = new URLSearchParams({
    pk: publicKey,
    redirect_uri: redirectUri,
    kn: XIAOMI_MIMO_CONFIG.kn,
  });
  if (keyName) params.set("key_name", keyName);
  return `${XIAOMI_MIMO_CONFIG.platformUrl}/authorize?${params.toString()}`;
}

/**
 * Get or create a stable key name for this installation.
 * Stored in the 9Router data dir so re-auth reuses the same name.
 */
export function getKeyName() {
  // Use a deterministic name based on machine — avoids needing filesystem writes
  // in the OAuth provider layer. The platform treats key_name as a label only.
  const machineId = crypto
    .createHash("sha256")
    .update(`${process.platform}-${process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown"}`)
    .digest("hex")
    .slice(0, 8);
  return `9router-xmd-${machineId}`;
}
