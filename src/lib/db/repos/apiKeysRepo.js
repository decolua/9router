import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    tokenLimit: row.tokenLimit || 0,
    usedTokens: row.usedTokens || 0,
    resetInterval: row.resetInterval || "never",
    lastResetAt: row.lastResetAt || null,
    allowedModels: row.allowedModels || "*",
    rpmLimit: row.rpmLimit || 0,
    tpmLimit: row.tpmLimit || 0,
    ipWhitelist: row.ipWhitelist || "",
    expiresAt: row.expiresAt || null,
    systemPrompt: row.systemPrompt || "",
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
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: now,
    tokenLimit: Number(options.tokenLimit) || 0,
    usedTokens: Number(options.usedTokens) || 0,
    resetInterval: options.resetInterval || "never",
    lastResetAt: options.lastResetAt || now,
    allowedModels: options.allowedModels || "*",
    rpmLimit: Number(options.rpmLimit) || 0,
    tpmLimit: Number(options.tpmLimit) || 0,
    ipWhitelist: options.ipWhitelist || "",
    expiresAt: options.expiresAt || null,
    systemPrompt: options.systemPrompt || "",
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenLimit, usedTokens, resetInterval, lastResetAt, allowedModels, rpmLimit, tpmLimit, ipWhitelist, expiresAt, systemPrompt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.createdAt,
      apiKey.tokenLimit,
      apiKey.usedTokens,
      apiKey.resetInterval,
      apiKey.lastResetAt,
      apiKey.allowedModels,
      apiKey.rpmLimit,
      apiKey.tpmLimit,
      apiKey.ipWhitelist,
      apiKey.expiresAt,
      apiKey.systemPrompt,
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
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, usedTokens = ?, resetInterval = ?, lastResetAt = ?, allowedModels = ?, rpmLimit = ?, tpmLimit = ?, ipWhitelist = ?, expiresAt = ?, systemPrompt = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        Number(merged.tokenLimit) || 0,
        Number(merged.usedTokens) || 0,
        merged.resetInterval || "never",
        merged.lastResetAt || null,
        merged.allowedModels || "*",
        Number(merged.rpmLimit) || 0,
        Number(merged.tpmLimit) || 0,
        merged.ipWhitelist || "",
        merged.expiresAt || null,
        merged.systemPrompt || "",
        id,
      ]
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

// In-memory sliding window rate limiter state for RPM/TPM per API key
if (!global._apiKeyRateLimits) global._apiKeyRateLimits = {};
const rateLimits = global._apiKeyRateLimits;

function checkRateLimits(key, rpmLimit, tpmLimit) {
  if (rpmLimit <= 0 && tpmLimit <= 0) return true;
  const now = Date.now();
  if (!rateLimits[key]) {
    rateLimits[key] = [];
  }

  // Filter out events older than 60 seconds (1 minute window)
  rateLimits[key] = rateLimits[key].filter((req) => now - req.ts < 60000);
  const recent = rateLimits[key];

  if (rpmLimit > 0 && recent.length >= rpmLimit) {
    return "RPM_EXCEEDED";
  }

  if (tpmLimit > 0) {
    const totalTokensInWindow = recent.reduce((sum, r) => sum + (r.tokens || 0), 0);
    if (totalTokensInWindow >= tpmLimit) {
      return "TPM_EXCEEDED";
    }
  }

  return true;
}

export function recordApiKeyUsageInWindow(key, tokens = 0) {
  if (!key) return;
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key].push({ ts: now, tokens: tokens || 0 });
}

/**
 * Allowed-model patterns of a key, or null when the key may use every model.
 * One definition for both the request gate and the /v1/models listing, so a key
 * can never see a model it would be refused at request time.
 */
export function parseAllowedModels(allowedModels) {
 const raw = String(allowedModels ?? "").trim();
 if (!raw || raw === "*") return null;
 const patterns = raw.split(",").map((model) => model.trim().toLowerCase()).filter(Boolean);
 return patterns.length ? patterns : null;
}

/** Exact, `prefix*` and `*suffix` patterns, matched case-insensitively. */
export function matchesAllowedModels(patterns, requestedModel) {
 if (!patterns) return true;
 const req = String(requestedModel || "").trim().toLowerCase();
 if (!req) return false;
 return patterns.some((allowed) => {
 if (allowed === "*" || allowed === req) return true;
 if (allowed.endsWith("*")) return req.startsWith(allowed.slice(0, -1));
 if (allowed.startsWith("*")) return req.endsWith(allowed.slice(1));
 return false;
 });
}

/** Patterns of the key used by a request; null when there is no key or it allows all. */
export async function getAllowedModelsOfKey(key) {
 const raw = typeof key === "string" ? key.trim() : "";
 if (!raw) return null;
 try {
 const db = await getAdapter();
 const row = db.get(`SELECT allowedModels FROM apiKeys WHERE key = ?`, [raw]);
 return row ? parseAllowedModels(row.allowedModels) : null;
 } catch {
 return null;
 }
}

export async function validateApiKey(key, requestedModel = null, clientIp = null) {
  const db = await getAdapter();
  let result = false;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!row) {
      result = false;
      return;
    }
    if (row.isActive !== 1 && row.isActive !== true) {
      // Its own reason code: a switched-off key must not be confused with an unknown one.
      result = "KEY_DISABLED";
      return;
    }

    // Check expiry (#3)
    if (row.expiresAt) {
      const expMs = new Date(row.expiresAt).getTime();
      if (!isNaN(expMs) && Date.now() > expMs) {
        result = "KEY_EXPIRED";
        return;
      }
    }


    // Check IP whitelist (empty = disabled/allow all)
    const ipWhitelist = (row.ipWhitelist || "").trim();
    if (ipWhitelist && clientIp) {
      const allowedIps = ipWhitelist.split(",").map((ip) => ip.trim()).filter(Boolean);
      if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
        result = "IP_NOT_ALLOWED";
        return;
      }
    }

    const tokenLimit = Number(row.tokenLimit) || 0;
    let usedTokens = Number(row.usedTokens) || 0;
    const resetInterval = row.resetInterval || "never";
    const allowedModels = row.allowedModels || "*";
    const nowMs = Date.now();
    let lastResetMs = row.lastResetAt
      ? new Date(row.lastResetAt).getTime()
      : new Date(row.createdAt).getTime();

    if (isNaN(lastResetMs)) lastResetMs = nowMs;

    let shouldReset = false;
    if (tokenLimit > 0 && resetInterval && resetInterval !== "never") {
      let intervalMs = 0;
      const num = parseInt(resetInterval, 10);
      if (resetInterval.endsWith("m")) {
        intervalMs = num * 60 * 1000;
      } else if (resetInterval.endsWith("h")) {
        intervalMs = num * 60 * 60 * 1000;
      } else if (resetInterval.endsWith("d")) {
        intervalMs = num * 24 * 60 * 60 * 1000;
      }

      if (intervalMs > 0 && nowMs - lastResetMs >= intervalMs) {
        shouldReset = true;
        const periodsPassed = Math.floor((nowMs - lastResetMs) / intervalMs);
        lastResetMs = lastResetMs + periodsPassed * intervalMs;
      }
    }

    if (shouldReset) {
      usedTokens = 0;
      const newResetIso = new Date(lastResetMs).toISOString();
      db.run(`UPDATE apiKeys SET usedTokens = 0, lastResetAt = ? WHERE id = ?`, [
        newResetIso,
        row.id,
      ]);
    }

    if (tokenLimit > 0 && usedTokens >= tokenLimit) {
      result = "QUOTA_EXCEEDED";
      return;
    }

    // Check allowed models
    const allowedPatterns = parseAllowedModels(allowedModels);
 if (requestedModel && allowedPatterns) {
      const isAllowed = matchesAllowedModels(allowedPatterns, requestedModel);

      if (!isAllowed) {
        result = "MODEL_NOT_ALLOWED";
        return;
      }
    }

    // Check RPM & TPM rate limits
    const rpmLimit = Number(row.rpmLimit) || 0;
    const tpmLimit = Number(row.tpmLimit) || 0;
    const rateCheck = checkRateLimits(key, rpmLimit, tpmLimit);
    if (rateCheck !== true) {
      result = rateCheck;
      return;
    }

    result = true;
  });

  return result;
}
