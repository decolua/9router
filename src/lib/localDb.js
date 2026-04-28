import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import fs from "node:fs";
import lockfile from "proper-lockfile";
import { DATA_DIR } from "@/lib/dataDir.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");

if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  observabilityEnabled: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 1024,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  rtkEnabled: true,
};

function cloneDefaultData() {
  return {
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    combos: [],
    apiKeys: [],
    settings: { ...DEFAULT_SETTINGS },
    pricing: {},
  };
}

if (!isCloud && DB_FILE && !fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(cloneDefaultData(), null, 2));
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

    if (key === "settings" && (typeof next.settings !== "object" || Array.isArray(next.settings))) {
      next.settings = { ...defaultValue };
      changed = true;
      continue;
    }

    if (key === "settings" && typeof next.settings === "object" && !Array.isArray(next.settings)) {
      for (const [settingKey, settingDefault] of Object.entries(defaultValue)) {
        if (next.settings[settingKey] === undefined) {
          // Backward-compat: if proxy URL was saved, default outboundProxyEnabled to true
          if (
            settingKey === "outboundProxyEnabled" &&
            typeof next.settings.outboundProxyUrl === "string" &&
            next.settings.outboundProxyUrl.trim()
          ) {
            next.settings.outboundProxyEnabled = true;
          } else {
            next.settings[settingKey] = settingDefault;
          }
          changed = true;
        }
      }
    }

    // Migrate existing API keys to have isActive
    if (key === "apiKeys" && Array.isArray(next.apiKeys)) {
      for (const apiKey of next.apiKeys) {
        if (apiKey.isActive === undefined || apiKey.isActive === null) {
          apiKey.isActive = true;
          changed = true;
        }
      }
    }
  }

  return { data: next, changed };
}

let dbInstance = null;

const LOCK_OPTIONS = {
  retries: { retries: 15, minTimeout: 50, maxTimeout: 3000 },
  stale: 10000,
};

class LocalMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire() {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }
    return new Promise((resolve) => {
      this._queue.push(() => resolve(() => this._release()));
    });
  }

  _release() {
    const next = this._queue.shift();
    if (next) next();
    else this._locked = false;
  }
}

const localMutex = new LocalMutex();

async function withFileLock(db, operation) {
  if (isCloud) {
    await operation();
    return;
  }

  const releaseLocal = await localMutex.acquire();
  let release = null;
  try {
    release = await lockfile.lock(DB_FILE, LOCK_OPTIONS);
    await operation();
  } catch (error) {
    if (error.code === "ELOCKED") {
      console.warn(`[DB] File is locked, retrying...`);
    }
    throw error;
  } finally {
    if (release) {
      try { await release(); } catch (_) { }
    }
    releaseLocal();
  }
}

async function safeRead(db) {
  await withFileLock(db, () => db.read());
}

async function safeWrite(db) {
  await withFileLock(db, () => db.write());
}

export async function getDb() {
  if (isCloud) {
    if (!dbInstance) {
      const data = cloneDefaultData();
      dbInstance = new Low({ read: async () => { }, write: async () => { } }, data);
      dbInstance.data = data;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    dbInstance = new Low(new JSONFile(DB_FILE), cloneDefaultData());
  }

  try {
    await safeRead(dbInstance);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[DB] Corrupt JSON detected, resetting to defaults...');
      dbInstance.data = cloneDefaultData();
      await safeWrite(dbInstance);
    } else {
      throw error;
    }
  }

  if (!dbInstance.data) {
    dbInstance.data = cloneDefaultData();
    await safeWrite(dbInstance);
  } else {
    const { data, changed } = ensureDbShape(dbInstance.data);
    dbInstance.data = data;
    if (changed) await safeWrite(dbInstance);
  }

  return dbInstance;
}

export async function getProviderConnections(filter = {}) {
  const db = await getDb();
  let connections = db.data.providerConnections || [];

  if (filter.provider) connections = connections.filter(c => c.provider === filter.provider);
  if (filter.isActive !== undefined) connections = connections.filter(c => c.isActive === filter.isActive);

  connections.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return connections;
}

export async function getProviderNodes(filter = {}) {
  const db = await getDb();
  let nodes = db.data.providerNodes || [];
  if (filter.type) nodes = nodes.filter((node) => node.type === filter.type);
  return nodes;
}

export async function getProviderNodeById(id) {
  const db = await getDb();
  return db.data.providerNodes.find((node) => node.id === id) || null;
}

export async function createProviderNode(data) {
  const db = await getDb();
  if (!db.data.providerNodes) db.data.providerNodes = [];

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
  await safeWrite(db);
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getDb();
  if (!db.data.providerNodes) db.data.providerNodes = [];

  const index = db.data.providerNodes.findIndex((node) => node.id === id);
  if (index === -1) return null;

  db.data.providerNodes[index] = {
    ...db.data.providerNodes[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await safeWrite(db);
  return db.data.providerNodes[index];
}

export async function deleteProviderNode(id) {
  const db = await getDb();
  if (!db.data.providerNodes) db.data.providerNodes = [];

  const index = db.data.providerNodes.findIndex((node) => node.id === id);
  if (index === -1) return null;

  const [removed] = db.data.providerNodes.splice(index, 1);
  await safeWrite(db);
  return removed;
}

export async function getProxyPools(filter = {}) {
  const db = await getDb();
  let pools = db.data.proxyPools || [];

  if (filter.isActive !== undefined) pools = pools.filter((pool) => pool.isActive === filter.isActive);
  if (filter.testStatus) pools = pools.filter((pool) => pool.testStatus === filter.testStatus);

  return pools.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export async function getProxyPoolById(id) {
  const db = await getDb();
  return (db.data.proxyPools || []).find((pool) => pool.id === id) || null;
}

export async function createProxyPool(data) {
  const db = await getDb();
  if (!db.data.proxyPools) db.data.proxyPools = [];

  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };

  db.data.proxyPools.push(pool);
  await safeWrite(db);
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getDb();
  if (!db.data.proxyPools) db.data.proxyPools = [];

  const index = db.data.proxyPools.findIndex((pool) => pool.id === id);
  if (index === -1) return null;

  db.data.proxyPools[index] = {
    ...db.data.proxyPools[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await safeWrite(db);
  return db.data.proxyPools[index];
}

export async function deleteProxyPool(id) {
  const db = await getDb();
  if (!db.data.proxyPools) db.data.proxyPools = [];

  const index = db.data.proxyPools.findIndex((pool) => pool.id === id);
  if (index === -1) return null;

  const [removed] = db.data.proxyPools.splice(index, 1);
  await safeWrite(db);
  return removed;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const db = await getDb();
  const beforeCount = db.data.providerConnections.length;
  db.data.providerConnections = db.data.providerConnections.filter(
    (connection) => connection.provider !== providerId
  );
  const deletedCount = beforeCount - db.data.providerConnections.length;
  await safeWrite(db);
  return deletedCount;
}

export async function getProviderConnectionById(id) {
  const db = await getDb();
  return db.data.providerConnections.find(c => c.id === id) || null;
}

export async function createProviderConnection(data) {
  const db = await getDb();
  const now = new Date().toISOString();

  // Upsert: check existing by provider + email (oauth) or provider + name (apikey)
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

  if (existingIndex !== -1) {
    db.data.providerConnections[existingIndex] = {
      ...db.data.providerConnections[existingIndex],
      ...data,
      updatedAt: now,
    };
    await safeWrite(db);
    return db.data.providerConnections[existingIndex];
  }

  let connectionName = data.name || null;
  if (!connectionName && data.authType === "oauth") {
    if (data.email) {
      connectionName = data.email;
    } else {
      const existingCount = db.data.providerConnections.filter(
        c => c.provider === data.provider
      ).length;
      connectionName = `Account ${existingCount + 1}`;
    }
  }

  let connectionPriority = data.priority;
  if (!connectionPriority) {
    const providerConnections = db.data.providerConnections.filter(c => c.provider === data.provider);
    const maxPriority = providerConnections.reduce((max, c) => Math.max(max, c.priority || 0), 0);
    connectionPriority = maxPriority + 1;
  }

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

  if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
    connection.providerSpecificData = data.providerSpecificData;
  }

  db.data.providerConnections.push(connection);
  await safeWrite(db);
  await reorderProviderConnections(data.provider);

  return connection;
}

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

  await safeWrite(db);
  if (data.priority !== undefined) await reorderProviderConnections(providerId);

  return db.data.providerConnections[index];
}

export async function deleteProviderConnection(id) {
  const db = await getDb();
  const index = db.data.providerConnections.findIndex(c => c.id === id);
  if (index === -1) return false;

  const providerId = db.data.providerConnections[index].provider;
  db.data.providerConnections.splice(index, 1);
  await safeWrite(db);
  await reorderProviderConnections(providerId);

  return true;
}

export async function reorderProviderConnections(providerId) {
  const db = await getDb();
  if (!db.data.providerConnections) return;

  const providerConnections = db.data.providerConnections
    .filter(c => c.provider === providerId)
    .sort((a, b) => {
      const pDiff = (a.priority || 0) - (b.priority || 0);
      if (pDiff !== 0) return pDiff;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

  providerConnections.forEach((conn, index) => {
    conn.priority = index + 1;
  });

  await safeWrite(db);
}

export async function getModelAliases() {
  const db = await getDb();
  return db.data.modelAliases || {};
}

export async function setModelAlias(alias, model) {
  const db = await getDb();
  db.data.modelAliases[alias] = model;
  await safeWrite(db);
}

export async function deleteModelAlias(alias) {
  const db = await getDb();
  delete db.data.modelAliases[alias];
  await safeWrite(db);
}

// Custom models — user-added models with explicit type (llm/image/tts/embedding/...)
export async function getCustomModels() {
  const db = await getDb();
  return db.data.customModels || [];
}

export async function addCustomModel({ providerAlias, id, type = "llm", name }) {
  const db = await getDb();
  if (!db.data.customModels) db.data.customModels = [];
  const exists = db.data.customModels.some(
    (m) => m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type
  );
  if (exists) return false;
  db.data.customModels.push({ providerAlias, id, type, name: name || id });
  await safeWrite(db);
  return true;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  const db = await getDb();
  if (!db.data.customModels) return;
  db.data.customModels = db.data.customModels.filter(
    (m) => !(m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type)
  );
  await safeWrite(db);
}

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
  await safeWrite(db);
}

export async function getCombos() {
  const db = await getDb();
  return db.data.combos || [];
}

export async function getComboById(id) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.id === id) || null;
}

export async function getComboByName(name) {
  const db = await getDb();
  return (db.data.combos || []).find(c => c.name === name) || null;
}

export async function createCombo(data) {
  const db = await getDb();
  if (!db.data.combos) db.data.combos = [];

  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    models: data.models || [],
    kind: data.kind || null,
    createdAt: now,
    updatedAt: now,
  };

  db.data.combos.push(combo);
  await safeWrite(db);
  return combo;
}

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

  await safeWrite(db);
  return db.data.combos[index];
}

export async function deleteCombo(id) {
  const db = await getDb();
  if (!db.data.combos) return false;

  const index = db.data.combos.findIndex(c => c.id === id);
  if (index === -1) return false;

  db.data.combos.splice(index, 1);
  await safeWrite(db);
  return true;
}

export async function getApiKeys() {
  const db = await getDb();
  return db.data.apiKeys || [];
}

function generateShortKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");

  const db = await getDb();
  const now = new Date().toISOString();

  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);

  const apiKey = {
    id: uuidv4(),
    name: name,
    key: result.key,
    machineId: machineId,
    isActive: true,
    createdAt: now,
  };

  db.data.apiKeys.push(apiKey);
  await safeWrite(db);
  return apiKey;
}

export async function deleteApiKey(id) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex(k => k.id === id);
  if (index === -1) return false;

  db.data.apiKeys.splice(index, 1);
  await safeWrite(db);
  return true;
}

export async function getApiKeyById(id) {
  const db = await getDb();
  return db.data.apiKeys.find(k => k.id === id) || null;
}

export async function updateApiKey(id, data) {
  const db = await getDb();
  const index = db.data.apiKeys.findIndex(k => k.id === id);
  if (index === -1) return null;
  db.data.apiKeys[index] = { ...db.data.apiKeys[index], ...data };
  await safeWrite(db);
  return db.data.apiKeys[index];
}

export async function validateApiKey(key) {
  const db = await getDb();
  const found = db.data.apiKeys.find(k => k.key === key);
  return found && found.isActive !== false;
}

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
    if (connection.providerSpecificData && Object.keys(connection.providerSpecificData).length === 0) {
      delete connection.providerSpecificData;
      cleaned++;
    }
  }

  if (cleaned > 0) await safeWrite(db);
  return cleaned;
}

export async function getSettings() {
  const db = await getDb();
  return db.data.settings || { cloudEnabled: false };
}

export async function updateSettings(updates) {
  const db = await getDb();
  db.data.settings = { ...db.data.settings, ...updates };
  await safeWrite(db);
  return db.data.settings;
}

export async function exportDb() {
  const db = await getDb();
  return db.data || cloneDefaultData();
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }

  const nextData = {
    ...cloneDefaultData(),
    ...payload,
    settings: {
      ...cloneDefaultData().settings,
      ...(payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)
        ? payload.settings
        : {}),
    },
  };

  const { data: normalized } = ensureDbShape(nextData);
  const db = await getDb();
  db.data = normalized;
  await safeWrite(db);
  return db.data;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return settings.cloudUrl || process.env.CLOUD_URL || process.env.NEXT_PUBLIC_CLOUD_URL || "";
}

export async function getPricing() {
  const db = await getDb();
  const userPricing = db.data.pricing || {};
  const { PROVIDER_PRICING } = await import("@/shared/constants/pricing.js");

  const merged = {};

  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
    merged[provider] = { ...models };
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        merged[provider][model] = merged[provider][model]
          ? { ...merged[provider][model], ...pricing }
          : pricing;
      }
    }
  }

  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) {
      merged[provider] = { ...models };
    } else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!merged[provider][model]) merged[provider][model] = pricing;
      }
    }
  }

  return merged;
}

export async function getPricingForModel(provider, model) {
  if (!model) return null;

  const db = await getDb();
  const userPricing = db.data.pricing || {};

  if (provider && userPricing[provider]?.[model]) {
    return userPricing[provider][model];
  }

  const { getPricingForModel: resolve } = await import("@/shared/constants/pricing.js");
  return resolve(provider, model);
}

export async function updatePricing(pricingData) {
  const db = await getDb();
  if (!db.data.pricing) db.data.pricing = {};

  for (const [provider, models] of Object.entries(pricingData)) {
    if (!db.data.pricing[provider]) db.data.pricing[provider] = {};
    for (const [model, pricing] of Object.entries(models)) {
      db.data.pricing[provider][model] = pricing;
    }
  }

  await safeWrite(db);
  return db.data.pricing;
}

export async function resetPricing(provider, model) {
  const db = await getDb();
  if (!db.data.pricing) db.data.pricing = {};

  if (model) {
    if (db.data.pricing[provider]) {
      delete db.data.pricing[provider][model];
      if (Object.keys(db.data.pricing[provider]).length === 0) {
        delete db.data.pricing[provider];
      }
    }
  } else {
    delete db.data.pricing[provider];
  }

  await safeWrite(db);
  return db.data.pricing;
}

export async function resetAllPricing() {
  const db = await getDb();
  db.data.pricing = {};
  await safeWrite(db);
  return db.data.pricing;
}
