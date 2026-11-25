import { publicText } from "../../../shared/utils/keyOwnership.js";
import { getAdapter } from "../driver.js";
import { validateKeyConnections } from "../../../shared/utils/keyConnections.js";

export class KeyConnectionError extends Error {}

export function migrateKeyConnections(db) {
  const columns = new Set(db.all("PRAGMA table_info(apiKeys)").map(column => column.name));
  for (const field of ["allowedConnections", "connectionProviders"]) {
    if (!columns.has(field)) db.exec(`ALTER TABLE apiKeys ADD COLUMN ${field} TEXT`);
  }
}

// Resolve and store both columns in the key write transaction. Only trusted
// backups may supply ownership for IDs which have since been deleted.
export function writeKeyConnections(db, keyId, input, backupProviders = null) {
  const checked = validateKeyConnections(input);
  if (checked.error) throw new KeyConnectionError(checked.error);
  const ids = checked.value;
  const providers = Object.create(null);
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.all(`SELECT id, provider FROM providerConnections WHERE id IN (${placeholders})`, ids);
    for (const row of rows) providers[row.id] = row.provider;
    for (const id of ids) {
      const saved = backupProviders && Object.hasOwn(backupProviders, id) ? backupProviders[id] : null;
      if (saved && providers[id] && saved !== providers[id]) {
        throw new KeyConnectionError("Connection provider differs from backup");
      }
      providers[id] ??= saved;
      if (typeof providers[id] !== "string" || !providers[id].trim()) {
        throw new KeyConnectionError("Unknown connection in allowedConnections");
      }
    }
  }
  db.run("UPDATE apiKeys SET allowedConnections = ?, connectionProviders = ? WHERE id = ?", [
    ids.length ? JSON.stringify(ids) : null,
    ids.length ? JSON.stringify(providers) : null,
    keyId,
  ]);
}

// Project metadata only; credentials never enter the result or need decryption.
export async function getPinnedKeysByConnection() {
  const db = await getAdapter();
  const byConnection = new Map();
  const rows = db.all(`
    SELECT id, name, allowedConnections
    FROM apiKeys
    WHERE allowedConnections IS NOT NULL
    ORDER BY name, id
  `);
  for (const row of rows) {
    const key = { id: row.id, name: publicText(row.name) ?? row.id };
    for (const connectionId of JSON.parse(row.allowedConnections)) {
      if (!byConnection.has(connectionId)) byConnection.set(connectionId, []);
      byConnection.get(connectionId).push(key);
    }
  }
  return byConnection;
}
