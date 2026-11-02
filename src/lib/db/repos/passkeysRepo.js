import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// WebAuthn credentials for dashboard login. Deliberately excluded from
// exportDb/importDb: a backup must not carry login credentials around.

function rowToPasskey(row) {
  if (!row) return null;
  const transports = parseJson(row.transports, []);
  return {
    id: row.id,
    publicKey: row.publicKey,
    counter: Number(row.counter) || 0,
    transports: Array.isArray(transports) ? transports : [],
    rpId: row.rpId,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: row.backedUp === 1 || row.backedUp === true,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt || null,
  };
}

export async function getPasskeys() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM passkeys ORDER BY createdAt ASC`).map(rowToPasskey);
}

export async function getPasskeyById(id) {
  if (typeof id !== "string" || !id) return null;
  const db = await getAdapter();
  return rowToPasskey(db.get(`SELECT * FROM passkeys WHERE id = ?`, [id]));
}

export async function countPasskeys() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) AS n FROM passkeys`);
  return Number(row?.n) || 0;
}

// Passkeys usable from a remote address. A credential bound to localhost (or *.localhost)
// only ever works on the host, where password login stays allowed anyway, so it must not
// count towards the "Passkey only" safeguards.
export async function countRemotePasskeys() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) AS n FROM passkeys WHERE rpId <> 'localhost' AND rpId NOT LIKE '%.localhost'`);
  return Number(row?.n) || 0;
}

export async function createPasskey({ id, publicKey, counter, transports, rpId, name, deviceType, backedUp }) {
  const db = await getAdapter();
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO passkeys(id, publicKey, counter, transports, rpId, name, deviceType, backedUp, createdAt, lastUsedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      publicKey,
      Number(counter) || 0,
      stringifyJson(Array.isArray(transports) ? transports : []),
      rpId,
      name || null,
      deviceType || null,
      backedUp ? 1 : 0,
      createdAt,
      null,
    ]
  );
  return getPasskeyById(id);
}

export async function updatePasskeyUsage(id, counter) {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE passkeys SET counter = ?, lastUsedAt = ? WHERE id = ?`,
    [Number(counter) || 0, new Date().toISOString(), id]
  );
  return (res?.changes ?? 0) > 0;
}

export async function renamePasskey(id, name) {
  const db = await getAdapter();
  const res = db.run(`UPDATE passkeys SET name = ? WHERE id = ?`, [name, id]);
  if ((res?.changes ?? 0) === 0) return null;
  return getPasskeyById(id);
}

export async function deletePasskey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM passkeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
