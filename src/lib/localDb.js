import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

// Get app name - fixed constant to avoid Windows path issues in standalone build
function getAppName() {
  return "9router";
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp"; // Fallback for Workers

  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os.homedir();
  const appName = getAppName();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
  } else {
    // macOS & Linux: ~/.{appName}
    return path.join(homeDir, `.${appName}`);
  }
}

// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");

// Ensure data directory exists
if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default data structure
const defaultData = {
  providerConnections: [],
  providerNodes: [],
  modelAliases: {},
  mitmAlias: {},
  combos: [],
  apiKeys: [],
  settings: {
    cloudEnabled: false,
    stickyRoundRobinLimit: 3,
    requireLogin: true,
    observabilityEnabled: true,
    observabilityMaxRecords: 1000,
    observabilityBatchSize: 20,
    observabilityFlushIntervalMs: 5000,
    observabilityMaxJsonSize: 1024
  },
  pricing: {} // NEW: pricing configuration
};

function cloneDefaultData() {
  return {
    providerConnections: [],
    providerNodes: [],
    modelAliases: {},
    mitmAlias: {},
    combos: [],
    apiKeys: [],
    settings: {
      cloudEnabled: false,
      stickyRoundRobinLimit: 3,
      requireLogin: true,
      observabilityEnabled: true,
      observabilityMaxRecords: 1000,
      observabilityBatchSize: 20,
      observabilityFlushIntervalMs: 5000,
      observabilityMaxJsonSize: 1024
    },
    pricing: {},
  };
}

function ensureDbShape(data) {
  const defaults = cloneDefaultData();
  const next = data && typeof data === "object" ? data : {};
  let changed = false;

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (next[key] === undefined || next[key] === null) {
      next[key] = defaultValue;
      changed = true;
      continue;
    }

    if (
      key === "settings" &&
      (typeof next.settings !== "object" || Array.isArray(next.settings))
    ) {
      next.settings = { ...defaultValue };
      changed = true;
      continue;
    }

    if (
      key === "settings" &&
      typeof next.settings === "object" &&
      !Array.isArray(next.settings)
    ) {
      for (const [settingKey, settingDefault] of Object.entries(defaultValue)) {
        if (next.settings[settingKey] === undefined) {
          next.settings[settingKey] = settingDefault;
          changed = true;
        }
      }
    }
  }

  return { data: next, changed };
}

// Singleton instance
let dbInstance = null;

/**
 * Get database instance (singleton)
 */
export async function getDb() {
  if (isCloud) {
    // Return in-memory DB for Workers
    if (!dbInstance) {
      const data = cloneDefaultData();
      dbInstance = new Low({ read: async () => {}, write: async () => {} }, data);
      dbInstance.data = data;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    dbInstance = new Low(adapter, cloneDefaultData());
  }

  // Always read latest disk state to avoid stale singleton data across route workers.
  try {
    await dbInstance.read();
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[DB] Corrupt JSON detected, resetting to defaults...');
      dbInstance.data = cloneDefaultData();
      await dbInstance.write();
    } else {
      throw error;
    }
  }

  // Initialize/migrate missing keys for older DB schema versions.
  if (!dbInstance.data) {
    dbInstance.data = cloneDefaultData();
    await dbInstance.write();
  } else {
    const { data, changed } = ensureDbShape(dbInstance.data);
    dbInstance.data = data;
    if (changed) {
      await dbInstance.write();
    }
  }

  return dbInstance;
}

// ============ Provider Connections ============

/**
 * Get all provider connections
 */
export async function getProviderConnections(filter = {}) {
  const db = await getDb();
  let connections = db.data.providerConnections || [];
  
  if (filter.provider) {
    connections = connections.filter(c => c.provider === filter.provider);
  }
  if (filter.isActive !== undefined) {
    connections = connections.filter(c => c.isActive === filter.isActive);
  }
  
  // Sort by priority (lower = higher priority)
  connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  
  return connections;
}

// ============ Provider Nodes ============

/**
 * Get provider nodes
 */
export async function getProviderNodes(filter = {}) {
  const db = await getDb();
  let nodes = db.data.providerNodes || [];

  if (filter.type) {
    nodes = nodes.filter((node) => node.type === filter.type);
  }

  return nodes;
}

/**
 * Get provider node by ID
 */
export async function getProviderNodeById(id) {
  const db = await getDb();
  return db.data.providerNodes.find((node) => node.id === id) || null;
}

/**
 * Create provider node
 */
export async function createProviderNode(data) {
  const db = await getDb();
  
  // Initialize providerNodes if undefined (backward compatibility)
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }
  
  const now = new Date().toISOString();

  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };

  db.data.providerNodes.push(node);
  await db.write();

  return node;
}

/**
 * Update provider node
 */
export async function updateProviderNode(id, data) {
  const db = await getDb();
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }
  
  const index = db.data.providerNodes.findIndex((node) => node.id === id);

  if (index === -1) return null;

  db.data.providerNodes[index] = {
    ...db.data.providerNodes[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();

  return db.data.providerNodes[index];
}

/**
 * Delete provider node
 */
export async function deleteProviderNode(id) {
  const db = await getDb();
  if (!db.data.providerNodes) {
    db.data.providerNodes = [];
  }
  
  const index = db.data.providerNodes.findIndex((node) => node.id === id);

  if (index === -1) return null;

  const [removed] = db.data.providerNodes.splice(index, 1);
  await db.write();

  return removed;
}

/**
 * Delete all provider connections by provider ID
 */
export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getDb();
  const beforeCount = db.data.providerConnections.length;
  db.data.providerConnections = db.data.providerConnections.filter(
    (connection) => connection.provider !== providerId
  );
  const deletedCount = beforeCount - db.data.providerConnections.length;
  await db.write();
  return deletedCount;
}

/**
 * Get provider connection by ID
 */
export async function getProviderConnectionById(id) {
  const db = await getDb();
  return db.data.providerConnections.find(c => c.id === id) || null;
}

/**
 * Create or update provider connection (upsert by provider + email/name)
 */
export async function createProviderConnection(data) {
  const db = await getDb();
  const now = new Date().toISOString();
  
  // Check for existing connection with same provider and email (for OAuth)
  // or same provider and name (for API key)
  let existingIndex = -1;
  if (data.authType === "oauth" && data.email) {
    existingIndex = db.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "oauth" && c.email === data.email
    );
  } else if (data.authType === "apikey" && data.name) {
    existingIndex = db.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "apikey" && c.name === data.name
    );
  }
  
  // If exists, update instead of create
  if (existingIndex !== -1) {
    db.data.providerConnections[existingIndex] = {
      ...db.data.providerConnections[existingIndex],
      ...data,
      updatedAt: now,
    };
    await db.write();
    return db.data.providerConnections[existingIndex];
  }
  
  // Generate name for OAuth if not provided
  let connectionName = data.name || null;
  if (!connectionName && data.authType === "oauth") {
    if (data.email) {
      connectionName = data.email;
    } else {
      // Count existing connections for this provider to generate index
      const existingCount = db.data.providerConnections.filter(
        c => c.provider === data.provider
      ).length;
      connectionName = `Account ${existingCount + 1}`;
    }
  }

  // Auto-increment priority if not provided
  let connectionPriority = data.priority;
  if (!connectionPriority) {
    const providerConnections = db.data.providerConnections.filter(
      c => c.provider === data.provider
    );
    const maxPriority = providerConnections.reduce((max, c) => Math.max(max, c.priority || 0), 0);
    connectionPriority = maxPriority + 1;
  }
  
  // Create new connection - only save fields with actual values
  const connection = {
    id: uuidv4(),
    provider: data.provider,
    authType: data.authType || "oauth",
    name: connectionName,
    priority: connectionPriority,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: now,
    updatedAt: now,
  };

  // Only add optional fields if they have values
  const optionalFields = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
    "consecutiveUseCount"
  ];
  
  for (const field of optionalFields) {
    if (data[field] !== undefined && data[field] !== null) {
      connection[field] = data[field];
    }
  }

  // Only add providerSpecificData if it has content
  if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
    connection.providerSpecificData = data.providerSpecificData;
  }
  
  db.data.providerConnections.push(connection);
  await db.write();

  // Reorder to ensure consistency
  await reorderProviderConnections(data.provider);

  return connection;
}

/**
 * Update provider connection
 */
export async function updateProviderConnection(id, data) {
  const db = await getDb();
  const index = db.data.providerConnections.findIndex(c => c.id === id);

  if (index === -1) return null;

  const providerId = db.data.providerConnections[index].provider;

  db.data.providerConnections[index] = {
    ...db.data.providerConnections[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await db.write();

  // Reorder if priority was changed
  if (data.priority !== undefined) {
    await reorderProviderConnections(providerId);
  }

  return db.data.providerConnections[index];
}

/**
 * Delete provider connection
 */
export async function deleteProviderConnection(id) {
  const db = await getDb();
  const index = db.data.providerConnections.findIndex(c => c.id === id);

  if (index === -1) return false;

  const providerId = db.data.providerConnections[index].provider;

  db.data.providerConnections.splice(index, 1);
  await db.write();

  // Reorder to fill gaps
  await reorderProviderConnections(providerId);

  return true;
}

/**
 * Reorder provider connections to ensure unique, sequential priorities
 */
export async function reorderProviderConnections(providerId) {
  const db = await getDb();
  if (!db.data.providerConnections) return;

  const providerConnections = db.data.providerConnections
    .filter(c => c.provider === providerId)
    .sort((a, b) => {
      // Sort by priority first
      const pDiff = (a.priority || 0) - (b.priority || 0);
      if (pDiff !== 0) return pDiff;
      // Use updatedAt as tie-breaker (newer first)
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

  // Re-assign sequential priorities
  providerConnections.forEach((conn, index) => {
    conn.priority = index + 1;
  });

  await db.write();
}

// ============ Model Aliases ============

/**
 * Get all model aliases
 */
export async function getModelAliases() {
  const db = await getDb();
  return db.data.modelAliases || {};
}

/**
 * Set model alias
 */
export async function setModelAlias(alias, model) {
  const db = await getDb();
  db.data.modelAliases[alias] = model;
  await db.write();
}

/**
 * Delete model alias
 */
export async function deleteModelAlias(alias) {
  const db = await getDb();
  delete db.data.modelAliases[alias];
  await db.write();
}

// ============ MITM Alias ============

export async function getMitmAlias(toolName) {
  const db = await getDb();
  const all = db.data.mitmAlias || {};
  if (toolName) return all[toolName] || {};
  return all;
}

export async function setMitmAliasAll(toolName, mappings) {
  const db = await getDb();
  if (!db.data.mitmAlias) db.data.mitmAlias = {};
  db.data.mitmAlias[toolName] = mappings || {};
  await db.write();
}

// ============ Combos ============

/**
 * Get all combos
 */
export async function getCombos() {
  const db = await getDb();
  return db.data.combos || [];
}

/**
 * Get combo by ID
 */
export async function getComboById(id) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.id === id) || null;
}

/**
 * Get combo by name
 */
export async function getComboByName(name) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.name === name) || null;
}

/**
 * Create combo
 */
export async function createCombo(data) {
  const db = await getDb();
  if (!db.data.combos) db.data.combos = [];
  
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  
  db.data.combos.push(combo);
  await db.write();
  return combo;
}

/**
 * Update combo
 */
export async function updateCombo(id, data) {
  const db = await getDb();
  if (!db.data.combos) db.data.combos = [];
  
  const index = db.data.combos.findIndex(c => c.id === id);
  if (index === -1) return null;
  
  db.data.combos[index] = {
    ...db.data.combos[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  
  await db.write();
  return db.data.combos[index];
}

/**
 * Delete combo
 */
export async function deleteCombo(id) {
  const db = await getDb();
  if (!db.data.combos) return false;
  
  const index = db.data.combos.findIndex(c => c.id === id);
  if (index === -1) return false;
  
  db.data.combos.splice(index, 1);
  await db.write();
  return true;
}

// ============ API Keys ============

function normalizeAllowedModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))];
}

function normalizeRotationHistory(value) {
  if (!Array.isArray(value)) {
    return { list: [], changed: value !== undefined && value !== null };
  }
  const list = [];
  let changed = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      changed = true;
      continue;
    }
    list.push(entry);
  }
  return { list, changed };
}

function hashApiKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function normalizePreviousKeys(value, nowMs) {
  if (!Array.isArray(value)) {
    return { list: [], changed: value !== undefined && value !== null };
  }
  const list = [];
  let changed = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      changed = true;
      continue;
    }
    const keyHash = String(entry.keyHash || "").trim();
    const key = String(entry.key || "").trim();
    let resolvedHash = keyHash;
    if (!resolvedHash && key) {
      resolvedHash = hashApiKey(key);
      changed = true;
    }
    if (!resolvedHash) {
      changed = true;
      continue;
    }
    const expiresAtMs = entry.expiresAt ? new Date(entry.expiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(expiresAtMs)) {
      changed = true;
      continue;
    }
    if (expiresAtMs <= nowMs) {
      changed = true;
      continue;
    }

    const cleaned = {
      keyHash: resolvedHash,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    if (entry.rotatedAt) {
      const rotatedAtMs = new Date(entry.rotatedAt).getTime();
      if (Number.isFinite(rotatedAtMs)) {
        cleaned.rotatedAt = new Date(rotatedAtMs).toISOString();
      } else {
        changed = true;
      }
    }
    list.push(cleaned);
  }
  return { list, changed };
}

function normalizeApiKeyDefaults(key, nowMs) {
  const normalized = { ...key };
  let changed = false;

  const isActive = normalized.isActive !== false;
  if (normalized.isActive !== isActive) {
    normalized.isActive = isActive;
    changed = true;
  }

  const previousResult = normalizePreviousKeys(normalized.previousKeys, nowMs);
  if (previousResult.changed) changed = true;
  normalized.previousKeys = previousResult.list;

  const historyResult = normalizeRotationHistory(normalized.rotationHistory);
  if (historyResult.changed) changed = true;
  normalized.rotationHistory = historyResult.list;

  if (Array.isArray(normalized.previousKeys)) {
    for (const entry of normalized.previousKeys) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.key !== undefined) {
        delete entry.key;
        changed = true;
      }
    }
  }

  return { normalized, changed };
}

function normalizeApiKeyResponse(key) {
  return {
    ...key,
    ownerName: key.ownerName || "",
    ownerEmail: key.ownerEmail || "",
    ownerAge: Number.isFinite(Number(key.ownerAge)) ? Number(key.ownerAge) : null,
    requestLimit: Number.isFinite(Number(key.requestLimit)) ? Number(key.requestLimit) : 0,
    tokenLimit: Number.isFinite(Number(key.tokenLimit)) ? Number(key.tokenLimit) : 0,
    requestUsed: Number.isFinite(Number(key.requestUsed)) ? Number(key.requestUsed) : 0,
    tokenUsed: Number.isFinite(Number(key.tokenUsed)) ? Number(key.tokenUsed) : 0,
    allowedModels: normalizeAllowedModels(key.allowedModels),
    isActive: key.isActive !== false,
    previousKeys: Array.isArray(key.previousKeys) ? key.previousKeys : [],
    rotationHistory: Array.isArray(key.rotationHistory) ? key.rotationHistory : [],
    lastAccessed: key.lastAccessed || null,
  };
}

function findApiKeyByValue(keys, keyValue, nowMs) {
  const lookupHash = hashApiKey(keyValue);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!key.isActive) continue;
    if (key.key === keyValue) {
      return { index: i, record: key };
    }
    if (Array.isArray(key.previousKeys)) {
      const matched = key.previousKeys.some((entry) => entry.keyHash === lookupHash);
      if (matched) return { index: i, record: key };
    }
  }
  return { index: -1, record: null };
}

/**
 * Get all API keys
 */
export async function getApiKeys() {
  const db = await getDb();
  const keys = db.data.apiKeys || [];
  const nowMs = Date.now();
  let changed = false;

  const results = keys.map((key, index) => {
    const normalizedResult = normalizeApiKeyDefaults(key, nowMs);
    if (normalizedResult.changed) {
      keys[index] = normalizedResult.normalized;
      changed = true;
    }
    return normalizeApiKeyResponse(normalizedResult.normalized);
  });

  if (changed) {
    await db.write();
  }

  return results;
}

/**
 * Get API key by ID
 */
export async function getApiKeyById(id) {
  const db = await getDb();
  const keys = db.data.apiKeys || [];
  const index = keys.findIndex((k) => k.id === id);
  if (index === -1) return null;

  const nowMs = Date.now();
  const normalizedResult = normalizeApiKeyDefaults(keys[index], nowMs);
  if (normalizedResult.changed) {
    keys[index] = normalizedResult.normalized;
    await db.write();
  }

  return normalizeApiKeyResponse(normalizedResult.normalized);
}

/**
 * Get API key by key value
 */
export async function getApiKeyByValue(keyValue) {
  const db = await getDb();
  if (!keyValue) return null;

  const keys = db.data.apiKeys || [];
  const nowMs = Date.now();
  let changed = false;

  for (let i = 0; i < keys.length; i += 1) {
    const normalizedResult = normalizeApiKeyDefaults(keys[i], nowMs);
    if (normalizedResult.changed) {
      keys[i] = normalizedResult.normalized;
      changed = true;
    }
  }

  const matched = findApiKeyByValue(keys, keyValue, nowMs);
  if (changed) {
    await db.write();
  }

  if (!matched.record) return null;
  return normalizeApiKeyResponse(matched.record);
}

/**
 * Generate short random key (8 chars)
 */
function generateShortKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create API key
 * @param {string} name - Key name
 * @param {string} machineId - MachineId (required)
 * @param {object} options - Optional metadata and quota
 */
export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) {
    throw new Error("machineId is required");
  }
  
  const db = await getDb();
  const now = new Date().toISOString();
  
  // Always use new format: sk-{machineId}-{keyId}-{crc8}
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  
  const apiKey = {
    id: uuidv4(),
    name: name,
    key: result.key,
    machineId: machineId,
    isActive: true,
    previousKeys: [],
    rotationHistory: [],
    ownerName: options.ownerName || "",
    ownerEmail: options.ownerEmail || "",
    ownerAge: Number.isFinite(Number(options.ownerAge)) ? Math.max(0, Number(options.ownerAge)) : null,
    requestLimit: Number.isFinite(Number(options.requestLimit)) ? Math.max(0, Number(options.requestLimit)) : 0,
    tokenLimit: Number.isFinite(Number(options.tokenLimit)) ? Math.max(0, Number(options.tokenLimit)) : 0,
    requestUsed: 0,
    tokenUsed: 0,
    allowedModels: Array.isArray(options.allowedModels)
      ? [...new Set(options.allowedModels.map((v) => String(v || "").trim()).filter(Boolean))]
      : [],
    lastAccessed: null,
    createdAt: now,
    updatedAt: now,
  };
  
  db.data.apiKeys.push(apiKey);
  await db.write();
  
  return apiKey;
}

/**
 * Update API key metadata or limits
 */
export async function updateApiKey(id, data = {}) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex((k) => k.id === id);
  if (index === -1) return null;

  const current = db.data.apiKeys[index];
  const update = {};

  if (data.name !== undefined) update.name = data.name;
  if (data.ownerName !== undefined) update.ownerName = data.ownerName;
  if (data.ownerEmail !== undefined) update.ownerEmail = data.ownerEmail;
  if (data.ownerAge !== undefined) {
    const n = Number(data.ownerAge);
    update.ownerAge = Number.isFinite(n) ? Math.max(0, n) : null;
  }
  if (data.requestLimit !== undefined) {
    const n = Number(data.requestLimit);
    update.requestLimit = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (data.tokenLimit !== undefined) {
    const n = Number(data.tokenLimit);
    update.tokenLimit = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (data.requestUsed !== undefined) {
    const n = Number(data.requestUsed);
    update.requestUsed = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (data.tokenUsed !== undefined) {
    const n = Number(data.tokenUsed);
    update.tokenUsed = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (data.isActive !== undefined) {
    update.isActive = data.isActive === true;
  }
  if (data.key !== undefined) {
    update.key = String(data.key || "").trim();
  }
  if (data.previousKeys !== undefined) {
    update.previousKeys = Array.isArray(data.previousKeys) ? data.previousKeys : [];
  }
  if (data.rotationHistory !== undefined) {
    update.rotationHistory = Array.isArray(data.rotationHistory) ? data.rotationHistory : [];
  }
  if (data.allowedModels !== undefined) {
    if (!Array.isArray(data.allowedModels)) {
      update.allowedModels = [];
    } else {
      update.allowedModels = [...new Set(data.allowedModels.map((v) => String(v || "").trim()).filter(Boolean))];
    }
  }
  if (data.lastAccessed !== undefined) {
    if (!data.lastAccessed) {
      update.lastAccessed = null;
    } else {
      const parsed = new Date(data.lastAccessed);
      update.lastAccessed = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }

  db.data.apiKeys[index] = {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  };

  await db.write();
  return db.data.apiKeys[index];
}

/**
 * Validate API key and consume one request quota unit
 */
export async function validateAndConsumeApiKeyRequest(keyValue) {
  const db = await getDb();
  const keys = db.data.apiKeys || [];
  const nowMs = Date.now();
  let changed = false;

  for (let i = 0; i < keys.length; i += 1) {
    const normalizedResult = normalizeApiKeyDefaults(keys[i], nowMs);
    if (normalizedResult.changed) {
      keys[i] = normalizedResult.normalized;
      changed = true;
    }
  }

  const match = findApiKeyByValue(keys, keyValue, nowMs);
  if (match.index === -1) {
    if (changed) await db.write();
    return { ok: false, code: "invalid_api_key", apiKey: null };
  }

  const apiKey = keys[match.index];
  const requestLimit = Number.isFinite(Number(apiKey.requestLimit)) ? Number(apiKey.requestLimit) : 0;
  const tokenLimit = Number.isFinite(Number(apiKey.tokenLimit)) ? Number(apiKey.tokenLimit) : 0;
  const requestUsed = Number.isFinite(Number(apiKey.requestUsed)) ? Number(apiKey.requestUsed) : 0;
  const tokenUsed = Number.isFinite(Number(apiKey.tokenUsed)) ? Number(apiKey.tokenUsed) : 0;

  if (requestLimit > 0 && requestUsed >= requestLimit) {
    return {
      ok: false,
      code: "request_quota_exceeded",
      apiKey: {
        ...apiKey,
        requestLimit,
        tokenLimit,
        requestUsed,
        tokenUsed,
      },
    };
  }

  if (tokenLimit > 0 && tokenUsed >= tokenLimit) {
    return {
      ok: false,
      code: "token_quota_exceeded",
      apiKey: {
        ...apiKey,
        requestLimit,
        tokenLimit,
        requestUsed,
        tokenUsed,
      },
    };
  }

  const now = new Date().toISOString();
  keys[match.index] = {
    ...apiKey,
    requestUsed: requestUsed + 1,
    requestLimit,
    tokenLimit,
    tokenUsed,
    lastAccessed: now,
    updatedAt: now,
  };

  await db.write();

  return {
    ok: true,
    code: null,
    apiKey: keys[match.index],
  };
}

/**
 * Increment API key request usage
 */
export async function incrementApiKeyRequestUsage(id, delta = 1) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex((k) => k.id === id);
  if (index === -1) return null;

  const key = db.data.apiKeys[index];
  const current = Number.isFinite(Number(key.requestUsed)) ? Number(key.requestUsed) : 0;
  const next = Math.max(0, current + Number(delta || 0));
  const now = new Date().toISOString();

  db.data.apiKeys[index] = {
    ...key,
    requestUsed: next,
    lastAccessed: now,
    updatedAt: now,
  };

  await db.write();
  return db.data.apiKeys[index];
}

/**
 * Increment API key token usage
 */
export async function incrementApiKeyTokenUsage(id, delta = 0) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex((k) => k.id === id);
  if (index === -1) return null;

  const key = db.data.apiKeys[index];
  const current = Number.isFinite(Number(key.tokenUsed)) ? Number(key.tokenUsed) : 0;
  const next = Math.max(0, current + Number(delta || 0));
  const now = new Date().toISOString();

  db.data.apiKeys[index] = {
    ...key,
    tokenUsed: next,
    lastAccessed: now,
    updatedAt: now,
  };

  await db.write();
  return db.data.apiKeys[index];
}

/**
 * Delete API key
 */
export async function deleteApiKey(id) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex(k => k.id === id);
  
  if (index === -1) return false;
  
  db.data.apiKeys.splice(index, 1);
  await db.write();
  
  return true;
}

/**
 * Validate API key
 */
export async function validateApiKey(key) {
  const db = await getDb();
  if (!key) return false;
  const keys = db.data.apiKeys || [];
  const nowMs = Date.now();
  let changed = false;

  for (let i = 0; i < keys.length; i += 1) {
    const normalizedResult = normalizeApiKeyDefaults(keys[i], nowMs);
    if (normalizedResult.changed) {
      keys[i] = normalizedResult.normalized;
      changed = true;
    }
  }

  const matched = findApiKeyByValue(keys, key, nowMs);
  if (changed) {
    await db.write();
  }
  return matched.index !== -1;
}

// ============ Data Cleanup ============

/**
 * Remove null/empty fields from all provider connections to reduce db size
 */
export async function cleanupProviderConnections() {
  const db = await getDb();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount"
  ];

  let cleaned = 0;
  for (const connection of db.data.providerConnections) {
    for (const field of fieldsToCheck) {
      if (connection[field] === null || connection[field] === undefined) {
        delete connection[field];
        cleaned++;
      }
    }
    // Remove empty providerSpecificData
    if (connection.providerSpecificData && Object.keys(connection.providerSpecificData).length === 0) {
      delete connection.providerSpecificData;
      cleaned++;
    }
  }

  if (cleaned > 0) {
    await db.write();
  }
  return cleaned;
}

// ============ Settings ============

/**
 * Get settings
 */
export async function getSettings() {
  const db = await getDb();
  return db.data.settings || { cloudEnabled: false };
}

/**
 * Update settings
 */
export async function updateSettings(updates) {
  const db = await getDb();
  db.data.settings = {
    ...db.data.settings,
    ...updates
  };
  await db.write();
  return db.data.settings;
}

/**
 * Export full database (including sensitive fields)
 */
export async function exportDb() {
  const db = await getDb();
  return db.data || {};
}

/**
 * Replace database with provided content
 */
export async function importDb(payload) {
  const db = await getDb();
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid database payload");
  }

  const data = { ...defaultData };
  const allowedKeys = Object.keys(defaultData);
  for (const key of allowedKeys) {
    if (payload[key] !== undefined) {
      data[key] = payload[key];
    }
  }

  db.data = data;
  await db.write();
  return db.data;
}

/**
 * Check if cloud is enabled
 */
export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

/**
 * Get cloud URL (UI config > env > default)
 */
export async function getCloudUrl() {
  const settings = await getSettings();
  return settings.cloudUrl
    || process.env.CLOUD_URL
    || process.env.NEXT_PUBLIC_CLOUD_URL
    || "";
}

// ============ Pricing ============

/**
 * Get pricing configuration
 * Returns merged user pricing with defaults
 */
export async function getPricing() {
  const db = await getDb();
  const userPricing = db.data.pricing || {};

  // Import default pricing
  const { getDefaultPricing } = await import("@/shared/constants/pricing.js");
  const defaultPricing = getDefaultPricing();

  // Merge user pricing with defaults
  // User pricing overrides defaults for specific provider/model combinations
  const mergedPricing = {};

  for (const [provider, models] of Object.entries(defaultPricing)) {
    mergedPricing[provider] = { ...models };

    // Apply user overrides if they exist
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        if (mergedPricing[provider][model]) {
          mergedPricing[provider][model] = { ...mergedPricing[provider][model], ...pricing };
        } else {
          mergedPricing[provider][model] = pricing;
        }
      }
    }
  }

  // Add any user-only pricing entries
  for (const [provider, models] of Object.entries(userPricing)) {
    if (!mergedPricing[provider]) {
      mergedPricing[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!mergedPricing[provider][model]) {
          mergedPricing[provider][model] = pricing;
        }
      }
    }
  }

  return mergedPricing;
}

/**
 * Get pricing for a specific provider and model
 */
export async function getPricingForModel(provider, model) {
  const pricing = await getPricing();

  // Try direct lookup
  if (pricing[provider]?.[model]) {
    return pricing[provider][model];
  }

  // Try mapping provider ID to alias
  // We need to duplicate the mapping here or import it
  // Since we can't easily import from open-sse, we'll implement the mapping locally
  const PROVIDER_ID_TO_ALIAS = {
    claude: "cc",
    codex: "cx",
    "gemini-cli": "gc",
    qwen: "qw",
    iflow: "if",
    antigravity: "ag",
    github: "gh",
    kiro: "kr",
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    openrouter: "openrouter",
    glm: "glm",
    kimi: "kimi",
    minimax: "minimax",
  };

  const alias = PROVIDER_ID_TO_ALIAS[provider];
  if (alias && pricing[alias]) {
    return pricing[alias][model] || null;
  }

  return null;
}

/**
 * Update pricing configuration
 * @param {object} pricingData - New pricing data to merge
 */
export async function updatePricing(pricingData) {
  const db = await getDb();

  // Ensure pricing object exists
  if (!db.data.pricing) {
    db.data.pricing = {};
  }

  // Merge new pricing data
  for (const [provider, models] of Object.entries(pricingData)) {
    if (!db.data.pricing[provider]) {
      db.data.pricing[provider] = {};
    }

    for (const [model, pricing] of Object.entries(models)) {
      db.data.pricing[provider][model] = pricing;
    }
  }

  await db.write();
  return db.data.pricing;
}

/**
 * Reset pricing to defaults for specific provider/model
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID (optional, if not provided resets entire provider)
 */
export async function resetPricing(provider, model) {
  const db = await getDb();

  if (!db.data.pricing) {
    db.data.pricing = {};
  }

  if (model) {
    // Reset specific model
    if (db.data.pricing[provider]) {
      delete db.data.pricing[provider][model];
      // Clean up empty provider objects
      if (Object.keys(db.data.pricing[provider]).length === 0) {
        delete db.data.pricing[provider];
      }
    }
  } else {
    // Reset entire provider
    delete db.data.pricing[provider];
  }

  await db.write();
  return db.data.pricing;
}

/**
 * Reset all pricing to defaults
 */
export async function resetAllPricing() {
  const db = await getDb();
  db.data.pricing = {};
  await db.write();
  return db.data.pricing;
}
