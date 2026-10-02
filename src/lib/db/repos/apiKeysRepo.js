import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  let allowedModels = ["*"];
  if (row.allowedModels) {
    try {
      allowedModels = typeof row.allowedModels === "string" ? JSON.parse(row.allowedModels) : row.allowedModels;
    } catch {
      allowedModels = [row.allowedModels];
    }
  }
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
    allowedModels = ["*"];
  }

  const isActive = row.isActive === 1 || row.isActive === true;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive,
    enabled: isActive,
    allowedModels,
    allowed_models: allowedModels,
    expiresAt: row.expiresAt || null,
    expires_at: row.expiresAt || null,
    createdAt: row.createdAt,
    created_at: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  const db = await getAdapter();
  let keyString = options.key;
  if (!keyString) {
    if (machineId) {
      const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
      keyString = generateApiKeyWithMachine(machineId).key;
    } else {
      const crypto = await import("node:crypto");
      keyString = `sk-${crypto.randomBytes(24).toString("hex")}`;
    }
  }

  let allowedModels = options.allowedModels || options.allowed_models || ["*"];
  if (typeof allowedModels === "string") {
    try {
      allowedModels = JSON.parse(allowedModels);
    } catch {
      allowedModels = allowedModels.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
    allowedModels = ["*"];
  }

  const isActive = options.isActive !== undefined
    ? Boolean(options.isActive)
    : (options.enabled !== undefined ? Boolean(options.enabled) : true);
  const expiresAt = options.expiresAt || options.expires_at || null;

  const now = new Date().toISOString();
  const apiKey = {
    id: uuidv4(),
    name,
    key: keyString,
    machineId: machineId || null,
    isActive,
    enabled: isActive,
    allowedModels,
    allowed_models: allowedModels,
    expiresAt,
    expires_at: expiresAt,
    createdAt: now,
    created_at: now,
  };

  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedModels, expiresAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      isActive ? 1 : 0,
      JSON.stringify(allowedModels),
      expiresAt,
      apiKey.createdAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;

    const current = rowToKey(row);
    let allowedModels = data.allowedModels !== undefined
      ? data.allowedModels
      : (data.allowed_models !== undefined ? data.allowed_models : current.allowedModels);
    if (typeof allowedModels === "string") {
      try {
        allowedModels = JSON.parse(allowedModels);
      } catch {
        allowedModels = allowedModels.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
      allowedModels = ["*"];
    }

    const isActive = data.isActive !== undefined
      ? Boolean(data.isActive)
      : (data.enabled !== undefined ? Boolean(data.enabled) : current.isActive);
    const expiresAt = data.expiresAt !== undefined
      ? data.expiresAt
      : (data.expires_at !== undefined ? data.expires_at : current.expiresAt);
    const name = data.name !== undefined ? data.name : current.name;
    const key = data.key !== undefined ? data.key : current.key;
    const machineId = data.machineId !== undefined ? data.machineId : current.machineId;

    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, expiresAt = ? WHERE id = ?`,
      [
        key,
        name,
        machineId,
        isActive ? 1 : 0,
        JSON.stringify(allowedModels),
        expiresAt,
        id,
      ]
    );

    result = {
      ...current,
      key,
      name,
      machineId,
      isActive,
      enabled: isActive,
      allowedModels,
      allowed_models: allowedModels,
      expiresAt,
      expires_at: expiresAt,
    };
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (!key) return false;
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const active = row.isActive === 1 || row.isActive === true;
  if (!active) return false;
  if (row.expiresAt) {
    const exp = new Date(row.expiresAt).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}
