import { getAdapter } from "../driver.js";

function rowToFitness(row) {
  if (!row) return null;
  return {
    poolId: row.poolId,
    scope: row.scope,
    until: row.until,
    reason: row.reason || "",
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProxyPoolFitness(poolId) {
  const db = await getAdapter();
  const rows = poolId === undefined || poolId === null
    ? db.all("SELECT * FROM proxyPoolFitness ORDER BY poolId, scope")
    : db.all("SELECT * FROM proxyPoolFitness WHERE poolId = ? ORDER BY scope", [poolId]);
  return rows.map(rowToFitness);
}

export async function upsertProxyPoolFitness(poolId, scope, until, reason = "") {
  if (!poolId || !scope || !Number.isFinite(until)) return null;
  const db = await getAdapter();
  const now = new Date().toISOString();
  let committed = null;
  db.transaction(() => {
    db.run(
      `INSERT INTO proxyPoolFitness(poolId, scope, until, reason, version, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(poolId, scope) DO UPDATE SET
         until = excluded.until,
         reason = excluded.reason,
         version = proxyPoolFitness.version + 1,
         updatedAt = excluded.updatedAt
       WHERE excluded.until >= proxyPoolFitness.until`,
      [poolId, scope, until, reason || "", now, now]
    );
    committed = rowToFitness(db.get("SELECT * FROM proxyPoolFitness WHERE poolId = ? AND scope = ?", [poolId, scope]));
  });
  return committed;
}

export async function deleteProxyPoolFitness(poolId, scope) {
  const db = await getAdapter();
  return db.run("DELETE FROM proxyPoolFitness WHERE poolId = ? AND scope = ?", [poolId, scope]);
}

export async function deleteProxyPoolFitnessVersion(poolId, scope, version) {
  if (!poolId || !scope || !Number.isInteger(version) || version < 1) return { changes: 0 };
  const db = await getAdapter();
  return db.run("DELETE FROM proxyPoolFitness WHERE poolId = ? AND scope = ? AND version = ?", [poolId, scope, version]);
}

export async function clearProxyPoolFitness(provider = null) {
  const db = await getAdapter();
  if (provider) {
    return db.run("DELETE FROM proxyPoolFitness WHERE scope = ? OR scope LIKE ?", [`${provider}::*`, `${provider}::%`]);
  }
  return db.run("DELETE FROM proxyPoolFitness");
}

export async function deleteProxyPoolFitnessByPool(poolId) {
  const db = await getAdapter();
  return db.run("DELETE FROM proxyPoolFitness WHERE poolId = ?", [poolId]);
}
