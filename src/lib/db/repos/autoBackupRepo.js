// Automatic-backup config + status (channel: telegram | github). Secrets are
// encrypted at rest with a machine-bound key (same scheme as mitm sudo
// password). Lives in its own KV scope so tokens never travel through the
// settings blob; it also round-trips inside DB backups (see exportDb/importDb)
// so a restored instance keeps its schedule.
import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";
import { makeKv } from "../helpers/kvStore.js";

const kv = makeKv("autoBackup");

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-backup-token-salt";

function deriveKey() {
  try {
    return crypto.createHash("sha256").update(machineIdSync() + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || !plaintext) return plaintext;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (typeof stored !== "string" || !stored) return "";
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) return stored; // pre-encryption plaintext value
  try {
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return ""; // wrong machine / tampered value
  }
}

const DEFAULT_CONFIG = {
  enabled: false,
  channel: "telegram", // telegram | github
  intervalHours: 24,
  tgBotToken: "",
  tgChatId: "",
  ghToken: "",
  ghRepo: "", // owner/repo
};

export async function getAutoBackupConfig() {
  const stored = { ...DEFAULT_CONFIG, ...(await kv.get("config", {})) };
  return {
    ...stored,
    tgBotToken: decryptSecret(stored.tgBotToken),
    ghToken: decryptSecret(stored.ghToken),
  };
}

// Patches may carry plaintext secrets; they are encrypted before storage.
// An empty-string secret means "keep the stored one" and must be omitted.
export async function setAutoBackupConfig(patch) {
  const current = { ...(await kv.get("config", {})) };
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "tgBotToken" || key === "ghToken") {
      if (typeof value === "string" && value) next[key] = encryptSecret(value.trim());
      continue;
    }
    next[key] = value;
  }
  await kv.set("config", next);
  return getAutoBackupConfig();
}

export async function getAutoBackupStatus() {
  return kv.get("status", null);
}

export async function setAutoBackupStatus(status) {
  await kv.set("status", status);
}
