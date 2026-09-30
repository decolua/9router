import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { DEFAULT_PERMISSIONS } from "@/lib/auth/permissionPaths";
// The allowed-model pattern language lives in a dependency-free module of its own:
// the request gate, the /v1/models listing and the usage dashboards all read it, and
// the self-check loads it without dragging in the database driver and uuid. Re-exported
// here so the existing `from "./apiKeysRepo.js"` importers are unaffected.
import { parseAllowedModels, matchesAllowedModels, buildAllowedModelsSql, applyModelChangesToAllowList } from "./allowedModels.js";

export { parseAllowedModels, matchesAllowedModels, buildAllowedModelsSql };

export function parsePermissions(permStr) {
  if (!permStr) return { ...DEFAULT_PERMISSIONS };
  if (typeof permStr === "object") return permStr;
  try {
    return JSON.parse(permStr);
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

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
    permissions: parsePermissions(row.permissions),
    createdBy: row.createdBy || "",
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
    permissions: typeof options.permissions === "object" ? options.permissions : parsePermissions(options.permissions),
    // The caller resolves who is creating the key. It is never inferred here:
    // this module has no session, and reaching for one turned every create into
    // a ReferenceError, which the route reported as a bare 500.
    createdBy: options.createdBy || "",
  };
  const permStr = typeof options.permissions === "string" ? options.permissions : JSON.stringify(apiKey.permissions);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenLimit, usedTokens, resetInterval, lastResetAt, allowedModels, rpmLimit, tpmLimit, ipWhitelist, expiresAt, systemPrompt, permissions, createdBy) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      permStr,
      apiKey.createdBy,
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
    const permStr = typeof merged.permissions === "string" ? merged.permissions : JSON.stringify(merged.permissions || {});
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, usedTokens = ?, resetInterval = ?, lastResetAt = ?, allowedModels = ?, rpmLimit = ?, tpmLimit = ?, ipWhitelist = ?, expiresAt = ?, systemPrompt = ?, permissions = ?, createdBy = ? WHERE id = ?`,
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
        permStr,
        merged.createdBy || "",
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

/**
 * Follow a model deletion or rename through every API key's allowlist.
 *
 * Callers name exactly what disappeared; nothing here scans the model catalog, so
 * an unreachable provider cannot shrink anyone's list. Fail-open by construction:
 * a throw anywhere below leaves every key as it was, and the mutation that
 * triggered this has already been committed.
 */
export async function reconcileAllowedModels({ removed = [], renamed = {} } = {}) {
  if (!removed.length && !Object.keys(renamed).length) {
    return { updated: 0, emptied: [] };
  }
  try {
    const keys = await getApiKeys();
    let updated = 0;
    const emptied = [];

    for (const key of keys) {
      const result = applyModelChangesToAllowList(key.allowedModels, { removed, renamed });
      if (result.emptied) { emptied.push(key.name || key.id); continue; }
      if (!result.changed) continue;
      await updateApiKey(key.id, { allowedModels: result.value });
      updated++;
    }
    return { updated, emptied };
  } catch (err) {
    console.error("[reconcileAllowedModels] failed to follow model change:", err);
    return { updated: 0, emptied: [] };
  }
}
