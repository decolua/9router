import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import lockfile from "proper-lockfile";

// All other functions are re-exported from SQLite DB layer
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl,
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  exportDb, importDb,
} from "@/lib/db/index.js";

// --- LowDB setup for Instances only ---
const isCloud = !process.versions?.node;

function getAppName() {
  return "9router";
}

function getUserDataDir() {
  if (isCloud) return "/tmp";
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os.homedir();
  const appName = getAppName();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
  }
  return path.join(homeDir, `.${appName}`);
}

const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");

if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cloneDefaultData() {
  return {
    instances: [],
  };
}

if (!isCloud && DB_FILE && !fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(cloneDefaultData(), null, 2));
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
      this._queue.push(resolve);
    }).then(() => () => this._release());
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
  } else if (!dbInstance.data.instances) {
    dbInstance.data.instances = [];
    await safeWrite(dbInstance);
  }

  return dbInstance;
}

// ─── Instances ───────────────────────────────────────────────────────────────

const DEFAULT_INSTANCE_PORTS = [2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038, 2039, 2040];

async function seedDefaultInstances(db) {
  if (!db.data.instances) db.data.instances = [];
  if (db.data.instances.length > 0) return;
  db.data.instances = DEFAULT_INSTANCE_PORTS.map((port, i) => ({
    id: uuidv4(),
    name: `Instance ${i + 1}`,
    port,
    dataDir: "",
    autoStart: false,
    createdAt: new Date().toISOString(),
  }));
  await safeWrite(db);
}

export async function getInstances() {
  const db = await getDb();
  await seedDefaultInstances(db);
  return db.data.instances || [];
}

export async function getInstanceById(id) {
  const db = await getDb();
  return (db.data.instances || []).find((i) => i.id === id) || null;
}

export async function createInstance(data) {
  const db = await getDb();
  if (!db.data.instances) db.data.instances = [];
  const instance = {
    id: uuidv4(),
    name: data.name || "Unnamed Instance",
    port: data.port,
    dataDir: data.dataDir || "",
    autoStart: data.autoStart ?? false,
    createdAt: new Date().toISOString(),
  };
  db.data.instances.push(instance);
  await safeWrite(db);
  return instance;
}

export async function updateInstance(id, updates) {
  const db = await getDb();
  if (!db.data.instances) db.data.instances = [];
  const idx = db.data.instances.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  db.data.instances[idx] = { ...db.data.instances[idx], ...updates };
  await safeWrite(db);
  return db.data.instances[idx];
}

export async function deleteInstance(id) {
  const db = await getDb();
  if (!db.data.instances) db.data.instances = [];
  const idx = db.data.instances.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  db.data.instances.splice(idx, 1);
  await safeWrite(db);
  return true;
}
