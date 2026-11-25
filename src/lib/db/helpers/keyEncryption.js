import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../../dataDir.js";
import { FatalStartupError } from "../fatalStartupError.js";

const keys = new WeakMap();
const keyFile = () => path.join(getDataDir(), "key-encryption-key");
const unavailable = file => new FatalStartupError("Invalid or missing gateway encryption key: " + file + "; restore it from backup");

function readKey(file) {
  let key;
  try { key = fs.readFileSync(file); } catch { throw unavailable(file); }
  if (key.length !== 32) throw unavailable(file);
  return key;
}

// Called inside the boot/migration transaction, before serving any requests.
export function initializeEncryption(db) {
  const file = keyFile();
  const hasChannels = db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notificationChannels'")
    && db.get("SELECT 1 FROM notificationChannels LIMIT 1");
  const encrypted = hasChannels || db.all("PRAGMA table_info(apiKeys)").some(c => c.name === "key_ciphertext")
    && db.get("SELECT 1 FROM apiKeys WHERE key_ciphertext IS NOT NULL LIMIT 1");
  if (!encrypted && !fs.existsSync(file)) {
    const temp = file + "." + randomUUID();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(file), 0o700);
    try {
      fs.writeFileSync(temp, randomBytes(32), { flag: "wx", mode: 0o600, flush: true });
      try { fs.linkSync(temp, file); } catch (err) { if (err.code !== "EEXIST") throw err; }
    } finally { fs.rmSync(temp, { force: true }); }
  }
  const key = readKey(file);
  const check = createHmac("sha256", key).update("9router:gateway-kek-check:v1").digest("hex");
  const saved = db.get("SELECT value FROM _meta WHERE key='gatewayKekCheck'");
  if (encrypted && saved?.value !== check) throw unavailable(file);
  if (saved?.value !== check) db.run("INSERT OR REPLACE INTO _meta VALUES('gatewayKekCheck',?)", [check]);
  keys.set(db, key);
}

function existingKey(db) {
  // Independent native connections (workers) only read an already published KEK.
  if (!keys.has(db)) keys.set(db, readKey(keyFile()));
  return keys.get(db);
}

const aad = (id, version) => Buffer.from(`9router:gateway-key:v1|${id}|${version}`);

export function encryptKey(db, id, version, key) {
  if (typeof key !== "string" || !key || key.includes("\0") || typeof id !== "string" || !id || id.includes("\0"))
    throw new Error("Invalid gateway key record");
  return seal(db, aad(id, version), key);
}

function seal(db, context, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", existingKey(db), nonce);
  cipher.setAAD(context);
  const sealed = Buffer.concat([cipher.update(key, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1:${nonce.toString("base64")}:${sealed.toString("base64")}`;
}

export function decryptKey(db, row) {
  return unseal(db, aad(row.id, row.key_version), row.key_ciphertext);
}

function unseal(db, context, ciphertext) {
  const kek = existingKey(db);
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const nonce = Buffer.from(parts[1], "base64"), sealed = Buffer.from(parts[2], "base64");
    if (nonce.length !== 12 || sealed.length <= 16 || nonce.toString("base64") !== parts[1] ||
        sealed.toString("base64") !== parts[2]) return null;
    const cipher = createDecipheriv("aes-256-gcm", kek, nonce);
    cipher.setAAD(context);
    cipher.setAuthTag(sealed.subarray(-16));
    return Buffer.concat([cipher.update(sealed.subarray(0, -16)), cipher.final()]).toString("utf8");
  } catch { return null; }
}

const channelAAD = (id, kind) => Buffer.from(`9router:notification-channel:v1|${id}|${kind}`);
export const encryptChannel = (db, id, kind, config) => seal(db, channelAAD(id, kind), JSON.stringify(config));
export const decryptChannel = (db, row) => JSON.parse(unseal(db, channelAAD(row.id, row.kind), row.config));
