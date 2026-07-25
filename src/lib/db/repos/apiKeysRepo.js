import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function normalizeAllowedModels(value) {
  if (!Array.isArray(value)) return null;
  const models = [...new Set(value.filter((model) => typeof model === "string" && model.trim()).map((model) => model.trim()))];
  return models.length ? models : null;
}

function normalizeTokenLimit(value) {
  if (value === undefined || value === null || value === "") return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("tokenLimit must be a positive integer");
  return limit;
}

function normalizeExpiry(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("expiresAt must be a valid date");
  return date.toISOString();
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    expiresAt: row.expiresAt || null,
    tokenLimit: row.tokenLimit == null ? null : Number(row.tokenLimit),
    tokensUsed: Number(row.tokensUsed || 0),
    tokensReserved: Number(row.tokensReserved || 0),
    allowedModels: (() => {
      try { return row.allowedModels ? JSON.parse(row.allowedModels) : null; }
      catch { return null; }
    })(),
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`).map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
}

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
}

export async function createApiKey(name, machineId, policy = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(), name, key: result.key, machineId, isActive: true,
    expiresAt: normalizeExpiry(policy.expiresAt),
    tokenLimit: normalizeTokenLimit(policy.tokenLimit),
    tokensUsed: 0, tokensReserved: 0,
    allowedModels: normalizeAllowedModels(policy.allowedModels),
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, expiresAt, tokenLimit, tokensUsed, tokensReserved, allowedModels, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.expiresAt, apiKey.tokenLimit, 0, 0, apiKey.allowedModels ? JSON.stringify(apiKey.allowedModels) : null, apiKey.createdAt]
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
    if (data.allowedModels !== undefined) merged.allowedModels = normalizeAllowedModels(data.allowedModels);
    if (data.expiresAt !== undefined) merged.expiresAt = normalizeExpiry(data.expiresAt);
    if (data.tokenLimit !== undefined) merged.tokenLimit = normalizeTokenLimit(data.tokenLimit);
    if (data.tokenLimitIncrement !== undefined) {
      const increment = normalizeTokenLimit(data.tokenLimitIncrement);
      if (merged.tokenLimit == null) throw new Error("Cannot add tokens to an unlimited key; set a token limit first");
      merged.tokenLimit += increment;
    }
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, expiresAt = ?, tokenLimit = ?, tokensUsed = ?, tokensReserved = ?, allowedModels = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.expiresAt || null, merged.tokenLimit == null ? null : Number(merged.tokenLimit), Number(merged.tokensUsed || 0), Number(merged.tokensReserved || 0), merged.allowedModels ? JSON.stringify(merged.allowedModels) : null, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return (db.run(`DELETE FROM apiKeys WHERE id = ?`, [id])?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const apiKey = await getApiKeyByValue(key);
  return !!apiKey && apiKey.isActive && (!apiKey.expiresAt || new Date(apiKey.expiresAt).getTime() > Date.now());
}

export async function reserveApiKeyTokens(key, requestedTokens) {
  const apiKey = await getApiKeyByValue(key);
  if (apiKey?.tokenLimit == null) return { ok: true, reserved: 0 };
  const reserve = Math.max(0, Math.floor(Number(requestedTokens) || 0));
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const row = db.get(`SELECT tokenLimit, tokensUsed, tokensReserved FROM apiKeys WHERE key = ? AND isActive = 1`, [key]);
    if (!row || row.tokenLimit == null || Number(row.tokensUsed || 0) + Number(row.tokensReserved || 0) + reserve > Number(row.tokenLimit)) return;
    db.run(`UPDATE apiKeys SET tokensReserved = tokensReserved + ? WHERE key = ?`, [reserve, key]);
    ok = true;
  });
  return ok ? { ok: true, reserved: reserve } : { ok: false, error: "API key token quota exceeded" };
}

export async function settleApiKeyTokens(key, reservedTokens, actualTokens) {
  if (!reservedTokens) return;
  const used = Math.min(reservedTokens, Math.max(0, Math.floor(Number(actualTokens) || 0)));
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`UPDATE apiKeys SET tokensReserved = MAX(0, tokensReserved - ?), tokensUsed = tokensUsed + ? WHERE key = ?`, [reservedTokens, used, key]);
  });
}
