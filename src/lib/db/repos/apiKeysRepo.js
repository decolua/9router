import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    kind: row.kind || "llm",
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys(kind = null) {
  const db = await getAdapter();
  if (kind) {
    const rows = db.all(
      `SELECT * FROM apiKeys WHERE kind = ? ORDER BY createdAt ASC`,
      [kind],
    );
    return rows.map(rowToKey);
  }
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, kind = "llm") {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();

  // Use different key generation based on kind
  let keyResult;
  if (kind === "mcp") {
    const { generateMcpApiKey } = await import("@/shared/utils/mcpApiKey");
    keyResult = generateMcpApiKey();
  } else {
    const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
    keyResult = generateApiKeyWithMachine(machineId);
  }

  const apiKey = {
    id: uuidv4(),
    name,
    key: keyResult.key,
    kind,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, kind, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.kind,
      apiKey.machineId,
      1,
      apiKey.createdAt,
    ],
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, kind = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.kind || "llm",
        merged.machineId,
        merged.isActive ? 1 : 0,
        id,
      ],
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key, kind = null) {
  const db = await getAdapter();
  if (kind) {
    const row = db.get(
      `SELECT isActive FROM apiKeys WHERE key = ? AND kind = ?`,
      [key, kind],
    );
    if (!row) return false;
    return row.isActive === 1 || row.isActive === true;
  }
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
