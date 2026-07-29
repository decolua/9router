// Migration 002: encrypt secrets at rest.
//
// Touches three columns:
//   - providerConnections.data  (JSON blob with refresh/access tokens, provider-specific creds)
//   - settings.data             (JSON blob with OIDC client secret + other sensitive config)
//   - apiKeys.key               (raw API key string) + adds apiKeys.keyHash for indexed lookup
//
// Behavior:
//   - Skips if MASTER_KEY is not configured: encryption is opt-in. Logs a warning so the
//     operator knows on-disk secrets remain plaintext. (The boot guard handles the inverse:
//     refuses to start if encrypted rows exist but MASTER_KEY is missing.)
//   - Each column is re-encrypted only if not already encrypted (idempotent: safe to re-run).
//   - Stamps the master-key fingerprint into _meta on completion so the boot guard can
//     detect "wrong key" without attempting blind decrypts.
//
// Failure handling: the whole migration runs inside one transaction (caller-provided in
// migrate.js). If any encryption fails, the transaction rolls back and schemaVersion is
// not advanced — next boot retries.

import crypto from "node:crypto";
import { isMasterKeyConfigured, getMasterKey, getKeyFingerprint } from "../../crypto/masterKey.js";
import { encrypt, isEncrypted } from "../../crypto/envelope.js";
import { setMetaSync } from "../helpers/metaStore.js";
import {
  readSettingsDataSync,
  readSettingsDataPostgres,
  writeSettingsDataSync,
  writeSettingsDataPostgres,
  settingsColumnsSync,
  settingsColumnsPostgres,
} from "../helpers/settingsRow.js";

const API_KEY_HASH_DOMAIN = "ebrouter-apikey-hash:";

function hashApiKey(plaintext) {
  if (!plaintext) return null;
  const h = crypto.createHash("sha256");
  h.update(API_KEY_HASH_DOMAIN);
  h.update(String(plaintext));
  return h.digest("hex");
}

function encryptIfNeeded(value, key) {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  if (isEncrypted(value)) return value;
  return encrypt(value, key);
}

export async function encryptSecretsPostgres(db) {
  const { qExec, qAll, qGet, qRun } = await import("../query.js");
  try { await qExec(db, `ALTER TABLE apiKeys ADD COLUMN keyHash TEXT`); } catch {}
  try { await qExec(db, `CREATE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)`); } catch {}

  const apiKeyRows = await qAll(db, `SELECT id, key, keyHash FROM apiKeys`);
  for (const r of apiKeyRows) {
    if (r.keyHash) continue;
    const plain = isEncrypted(r.key) ? null : r.key;
    if (plain == null) continue;
    await qRun(db, `UPDATE apiKeys SET keyHash = ? WHERE id = ?`, [hashApiKey(plain), r.id]);
  }

  if (!isMasterKeyConfigured()) {
    console.warn("[DB][migrate] 002-encrypt-secrets: MASTER_KEY not set — leaving secrets plaintext.");
    return;
  }

  const key = getMasterKey();
  const pcRows = await qAll(db, `SELECT id, data FROM providerConnections`);
  for (const r of pcRows) {
    const next = encryptIfNeeded(r.data, key);
    if (next !== r.data) await qRun(db, `UPDATE providerConnections SET data = ? WHERE id = ?`, [next, r.id]);
  }

  const settingsRaw = await readSettingsDataPostgres(db);
  if (settingsRaw) {
    const next = encryptIfNeeded(settingsRaw, key);
    if (next !== settingsRaw) {
      const cols = await settingsColumnsPostgres(db);
      if (cols.has("orgId")) {
        await qRun(db, `UPDATE settings SET data = ? WHERE "orgId" = (SELECT "orgId" FROM settings LIMIT 1)`, [next]);
      } else {
        await qRun(db, `UPDATE settings SET data = ? WHERE id = 1`, [next]);
      }
    }
  }

  for (const r of apiKeyRows) {
    const next = encryptIfNeeded(r.key, key);
    if (next !== r.key) await qRun(db, `UPDATE apiKeys SET key = ? WHERE id = ?`, [next, r.id]);
  }

  await qRun(db, `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ["masterKeyFingerprint", getKeyFingerprint()]);
  await qRun(db, `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ["encryptionEnabledAt", new Date().toISOString()]);
}

export default {
  version: 2,
  name: "encrypt-secrets",
  up(db) {
    // Ensure keyHash column exists before we write to it.
    try { db.exec(`ALTER TABLE apiKeys ADD COLUMN keyHash TEXT`); } catch { /* already exists */ }
    try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)`); } catch {}

    // Always backfill keyHash — needed for lookups regardless of encryption status.
    const apiKeyRows = db.all(`SELECT id, key, keyHash FROM apiKeys`);
    for (const r of apiKeyRows) {
      if (r.keyHash) continue;
      const plain = isEncrypted(r.key) ? null : r.key; // can't hash if already encrypted with no key
      if (plain == null) continue;
      db.run(`UPDATE apiKeys SET keyHash = ? WHERE id = ?`, [hashApiKey(plain), r.id]);
    }

    if (!isMasterKeyConfigured()) {
      console.warn("[DB][migrate] 002-encrypt-secrets: MASTER_KEY not set — leaving secrets plaintext. Set MASTER_KEY to enable encryption.");
      return;
    }

    const key = getMasterKey();

    // providerConnections.data
    const pcRows = db.all(`SELECT id, data FROM providerConnections`);
    for (const r of pcRows) {
      const next = encryptIfNeeded(r.data, key);
      if (next !== r.data) db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [next, r.id]);
    }

    const settingsRaw = readSettingsDataSync(db);
    if (settingsRaw) {
      const next = encryptIfNeeded(settingsRaw, key);
      if (next !== settingsRaw) {
        const cols = settingsColumnsSync(db);
        if (cols.has("orgId")) {
          db.run(`UPDATE settings SET data = ? WHERE rowid = (SELECT rowid FROM settings LIMIT 1)`, [next]);
        } else {
          db.run(`UPDATE settings SET data = ? WHERE id = 1`, [next]);
        }
      }
    }

    // apiKeys.key — encrypt for display. keyHash already backfilled above for lookups.
    for (const r of apiKeyRows) {
      const next = encryptIfNeeded(r.key, key);
      if (next !== r.key) db.run(`UPDATE apiKeys SET key = ? WHERE id = ?`, [next, r.id]);
    }

    // Stamp fingerprint so boot guard can detect key mismatch.
    setMetaSync(db, "masterKeyFingerprint", getKeyFingerprint());
    setMetaSync(db, "encryptionEnabledAt", new Date().toISOString());
    console.log(`[DB][migrate] 002-encrypt-secrets: encrypted ${pcRows.length} connections, ${apiKeyRows.length} api keys, settings. fp=${getKeyFingerprint()}`);
  },
};
