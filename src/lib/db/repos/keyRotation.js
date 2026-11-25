import { decryptKey, encryptKey } from "../helpers/keyEncryption.js";
import { randomBytes } from "node:crypto";
import { generateApiKeyWithMachine } from "../../../shared/utils/apiKey.js";
import { keyVerifier } from "../helpers/keyVerifier.js";
import { fingerprint } from "../helpers/usageFingerprint.js";

export function rotateKey(db, id, expectedVersion) {
  if (db.driver === "sql.js") return { status: 503 };
  const previous = db.get("SELECT id, key_ciphertext, machineId, key_version FROM apiKeys WHERE id=?", [id]);
  if (!previous) return { status: 404 };
  if (previous.key_version !== expectedVersion) return { status: 409 };
  const oldKey = decryptKey(db, previous);
  if (oldKey === null) throw new Error("Cannot rotate unreadable gateway key");
  return db.transaction(() => {
    const key = previous.machineId ? generateApiKeyWithMachine(previous.machineId).key : `sk-${randomBytes(32).toString("hex")}`;
    // First SQL statement takes the writer lock and checks the caller's version.
    const changed = db.run("UPDATE apiKeys SET key_ciphertext=?, key_verifier=?, key_version=key_version+1 WHERE id=? AND key_version=? AND key_ciphertext=?",
      [encryptKey(db, id, expectedVersion + 1, key), keyVerifier(key), id, expectedVersion, previous.key_ciphertext]);
    if (!changed.changes) return { status: 409 };
    db.run("INSERT INTO retiredKeyFingerprints(fingerprint,keyId) VALUES(?,?)", [fingerprint(oldKey), id]);
    return { status: 200, id, key, keyVersion: expectedVersion + 1 };
  });
}
