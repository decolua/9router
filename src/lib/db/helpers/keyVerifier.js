import { decryptKey } from "./keyEncryption.js";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../../dataDir.js";

let pepper;
let pepperDirectory;
function verifierSecret() {
  const configured = process.env.API_KEY_SECRET;
  if (configured && configured !== "endpoint-proxy-api-key-secret") return configured;
  if (pepper && pepperDirectory === process.env.DATA_DIR) return pepper;
  const directory = getDataDir();
  const file = path.join(directory, "key-verifier-pepper");
  try {
    pepper = fs.readFileSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = file + "." + randomUUID();
    fs.writeFileSync(temp, randomBytes(32), { flag: "wx", mode: 0o600 });
    try {
      // Publish the complete secret once, even during concurrent first boots.
      fs.linkSync(temp, file);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    } finally {
      fs.unlinkSync(temp);
    }
    pepper = fs.readFileSync(file);
  }
  if (pepper.length !== 32) {
    pepper = undefined;
    throw new Error("Invalid gateway verifier pepper");
  }
  pepperDirectory = process.env.DATA_DIR;
  return pepper;
}

export function keyVerifier(key) {
  return createHmac("sha256", verifierSecret()).update("9router:gateway-key:v1\0").update(key).digest("hex");
}

function secretCheck() {
  return createHmac("sha256", verifierSecret()).update("9router:gateway-verifier-check:v1").digest("hex");
}

export function stampVerifierSecret(db, check = secretCheck()) {
  db.run("INSERT OR REPLACE INTO _meta VALUES('gatewayVerifierCheck',?)", [check]);
}

export function syncVerifierSecret(db) {
  const check = secretCheck();
  db.transaction(() => {
    if (db.get("SELECT value FROM _meta WHERE key='gatewayVerifierCheck'")?.value === check) return;
    for (const row of db.all("SELECT id,key_version,key_ciphertext FROM apiKeys")) {
      const key = decryptKey(db, row);
      db.run("UPDATE apiKeys SET key_verifier=? WHERE id=?", [key === null ? null : keyVerifier(key), row.id]);
    }
    stampVerifierSecret(db, check);
  });
}

export function findVerifiedKey(db, key) {
  if (typeof key !== "string" || !key || key.includes("\0")) return null;
  const digest = keyVerifier(key);
  const row = db.get("SELECT * FROM apiKeys WHERE key_verifier=?", [digest]);
  if (!row || !timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(row.key_verifier, "hex"))) return null;
  const secret = decryptKey(db, row);
  return secret === null ? null : { ...row, key: secret };
}
