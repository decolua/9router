import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? null,
    key: row.key,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getGatewayKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM mcpGatewayKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getGatewayKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpGatewayKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createGatewayKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const { key } = generateApiKeyWithMachine(machineId);
  const row = {
    id: uuidv4(),
    name: name ?? null,
    key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO mcpGatewayKeys(id, name, key, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.key, row.machineId, 1, row.createdAt]
  );
  return row;
}

export async function deleteGatewayKey(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM mcpKeyGrants WHERE keyId = ?`, [id]);
  const res = db.run(`DELETE FROM mcpGatewayKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/**
 * Resolve a raw gateway key string (from Authorization: Bearer or x-api-key) to its
 * persisted row. Returns null on miss or inactive.
 */
export async function validateGatewayKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM mcpGatewayKeys WHERE key = ?`, [rawKey]);
  if (!row) return null;
  if (!(row.isActive === 1 || row.isActive === true)) return null;
  return rowToKey(row);
}

/**
 * Plain grant reader: returns one entry per granted instance id.
 */
export async function getGrantsForKey(keyId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT instanceId FROM mcpKeyGrants WHERE keyId = ?`, [keyId]);
  return rows.map((r) => r.instanceId);
}

/**
 * Richer grant reader: returns one entry per granted instance, including
 * the per-grant tool allowlist (parsed JSON array of bare tool names, or
 * null = all tools visible).
 */
export async function getGrantsForKeyDetailed(keyId) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT instanceId, toolAllowlist FROM mcpKeyGrants WHERE keyId = ?`,
    [keyId]
  );
  return rows.map((r) => {
    let toolAllowlist = null;
    const raw = r.toolAllowlist;
    if (raw != null && raw !== "") {
      const parsed = parseJson(raw, null);
      if (Array.isArray(parsed)) toolAllowlist = parsed.map(String);
    }
    return { instanceId: r.instanceId, toolAllowlist };
  });
}

/**
 * Replace the grant set for a key (idempotent; not additive). Pass [] to
 * revoke all grants. `toolAllowlists` is an optional parallel array of
 * allowlists indexed by the same position as `instanceIds`. An entry
 * of `null` (or `undefined`) clears the per-grant allowlist.
 */
export async function setGrants(keyId, instanceIds, toolAllowlists) {
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM mcpKeyGrants WHERE keyId = ?`, [keyId]);
    if (Array.isArray(instanceIds) && instanceIds.length > 0) {
      instanceIds.forEach((id, i) => {
        const allow = toolAllowlists?.[i];
        const allowJson = (Array.isArray(allow) && allow.length > 0) ? stringifyJson(allow.map(String)) : null;
        db.run(
          `INSERT OR IGNORE INTO mcpKeyGrants(keyId, instanceId, toolAllowlist) VALUES(?, ?, ?)`,
          [keyId, id, allowJson]
        );
      });
    }
  });
}
