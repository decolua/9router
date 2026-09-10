import crypto from "crypto";

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-conn-secret";
const ENC_PREFIX = "enc1:";

function deriveKey() {
  if (process.env.DB_ENCRYPTION_KEY) {
    return crypto.createHash("sha256").update(process.env.DB_ENCRYPTION_KEY).digest();
  }
  try {
    const { machineIdSync } = require("node-machine-id");
    const raw = machineIdSync();
    return crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(stored) {
  const [ivHex, tagHex, dataHex] = stored.slice(ENC_PREFIX.length).split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("malformed secret ciphertext");
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
}

// Encrypts a JSON-serializable value for storage in a `data` column.
export function encryptSecretJson(value) {
  return encrypt(JSON.stringify(value ?? null));
}

// Decrypts a value stored by encryptSecretJson. Transparently reads legacy
// plaintext JSON (no "enc1:" prefix) written before this encryption was added.
export function decryptSecretJson(stored, fallback = null) {
  if (stored == null) return fallback;
  try {
    if (typeof stored === "string" && stored.startsWith(ENC_PREFIX)) {
      return JSON.parse(decrypt(stored));
    }
    return JSON.parse(stored);
  } catch {
    return fallback;
  }
}
