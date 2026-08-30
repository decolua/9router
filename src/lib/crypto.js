import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit recommended for GCM
const PREFIX = "enc:v1:";

let cachedKey = null;

function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  if (process.env.DB_ENCRYPTION_KEY) {
    const raw = process.env.DB_ENCRYPTION_KEY.trim();
    cachedKey = crypto.createHash("sha256").update(raw).digest();
    return cachedKey;
  }

  const keyFile = path.join(DATA_DIR, "db-encryption-key");
  try {
    const persisted = fs.readFileSync(keyFile);
    if (persisted.length === 32) {
      cachedKey = persisted;
      return cachedKey;
    }
  } catch {}

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, generated, { mode: 0o600 });
    cachedKey = generated;
    return cachedKey;
  } catch {
    // Fallback in-memory deterministic key from machine secret if directory is strictly read-only
    cachedKey = crypto.createHash("sha256").update("9router-db-fallback-key").digest();
    return cachedKey;
  }
}

/**
 * Encrypts a sensitive string using AES-256-GCM.
 * If input is empty, null or already encrypted, returns input.
 * @param {string} plainText
 * @returns {string}
 */
export function encryptSecret(plainText) {
  if (typeof plainText !== "string" || !plainText) return plainText;
  if (plainText.startsWith(PREFIX)) return plainText; // Already encrypted

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");
    return `${PREFIX}${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error("Encryption error:", error);
    return plainText;
  }
}

/**
 * Decrypts an AES-256-GCM cipher string.
 * If input is not encrypted or in plain text, returns input as is (backward compatible).
 * @param {string} cipherText
 * @returns {string}
 */
export function decryptSecret(cipherText) {
  if (typeof cipherText !== "string" || !cipherText) return cipherText;
  if (!cipherText.startsWith(PREFIX)) return cipherText; // Plaintext backward compatibility

  try {
    const payload = cipherText.slice(PREFIX.length);
    const [ivHex, authTagHex, encryptedHex] = payload.split(":");
    if (!ivHex || !authTagHex || !encryptedHex) return cipherText;

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    return cipherText;
  }
}
