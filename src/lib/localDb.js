// Public config DB facade. SQLite-backed on Node; in-memory lowdb stub on
// Cloudflare Workers. Public API surface unchanged from the previous
// lowdb+JSON implementation so the 35+ consumer files keep working.

import { Low } from "lowdb";
import { v4 as uuidv4 } from "uuid";
import { getDatabase } from "./sqlite/connection.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const isCloud = typeof caches !== "undefined" || typeof caches === "object";

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
  rtkEnabled: false,
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

// ===== Cloud/Workers branch — in-memory only, no persistence ==============

let cloudDb = null;

async function getCloudDb() {
  if (!cloudDb) {
    const data = cloneDefaultData();
    cloudDb = new Low({ read: async () => {}, write: async () => {} }, data);
    cloudDb.data = data;
  }
  return cloudDb;
}

// ===== Node SQLite branch ================================================

// `getDatabase()` is itself lazy — it opens better-sqlite3 on first call, so
// simply re-exposing it keeps the cloud branch from ever touching the
// native module.
const db = getDatabase;

const CONN_COLS = new Set(["id", "provider", "authType", "name", "priority",
  "isActive", "createdAt", "updatedAt"]);
const NODE_COLS = new Set(["id", "type", "name", "prefix", "apiType",
  "baseUrl", "createdAt", "updatedAt"]);
const POOL_COLS = new Set(["id", "name", "proxyUrl", "type", "isActive",
  "createdAt", "updatedAt"]);
const COMBO_COLS = new Set(["id", "name", "createdAt", "updatedAt"]);

function splitExtras(obj, cols) {
  const extras = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!cols.has(k)) extras[k] = v;
  }
  return extras;
}

function parseExtras(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function rowToConnection(r) {
  return {
    ...parseExtras(r.data),
    id: r.id,
    provider: r.provider,
    authType: r.auth_type || undefined,
    name: r.name ?? null,
    priority: r.priority ?? null,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToNode(r) {
  return {
    ...parseExtras(r.data),
    id: r.id,
    type: r.type,
    name: r.name,
    prefix: r.prefix,
    apiType: r.api_type,
    baseUrl: r.base_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPool(r) {
  return {
    ...parseExtras(r.data),
    id: r.id,
    name: r.name,
    proxyUrl: r.proxy_url,
    type: r.type,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToCombo(r) {
  return {
    ...parseExtras(r.data),
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToApiKey(r) {
  return {
    id: r.id,
    name: r.name,
    key: r.key,
    machineId: r.machine_id,
    isActive: r.is_active !== 0,
    createdAt: r.created_at,
  };
}

function nowIso() { return new Date().toISOString(); }

// ===== Provider Connections ==============================================

export async function getProviderConnections(filter = {}) {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.providerConnections || [];
    if (filter.provider) list = list.filter(c => c.provider === filter.provider);
    if (filter.isActive !== undefined) list = list.filter(c => c.isActive === filter.isActive);
    return [...list].sort((a, b) => (a.priority || 999) - (b.priority || 999));
  }

  const clauses = [];
  const params = [];
  if (filter.provider) { clauses.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) {
    clauses.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db().prepare(
    `SELECT * FROM provider_connections ${where} ORDER BY COALESCE(priority, 999), updated_at DESC`,
  ).all(...params);
  return rows.map(rowToConnection);
}

export async function getProviderConnectionById(id) {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.providerConnections.find(c => c.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM provider_connections WHERE id = ?").get(id);
  return r ? rowToConnection(r) : null;
}

async function insertConnectionRow(conn) {
  const extras = splitExtras(conn, CONN_COLS);
  db().prepare(`
    INSERT INTO provider_connections
    (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conn.id, conn.provider, conn.authType || null, conn.name ?? null,
    conn.priority ?? null, conn.isActive === false ? 0 : 1,
    JSON.stringify(extras), conn.createdAt, conn.updatedAt,
  );
}

async function updateConnectionRow(id, patch) {
  const current = await getProviderConnectionById(id);
  if (!current) return null;
  const merged = { ...current, ...patch, updatedAt: nowIso() };
  const extras = splitExtras(merged, CONN_COLS);
  db().prepare(`
    UPDATE provider_connections
    SET provider = ?, auth_type = ?, name = ?, priority = ?, is_active = ?,
        data = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.provider, merged.authType || null, merged.name ?? null,
    merged.priority ?? null, merged.isActive === false ? 0 : 1,
    JSON.stringify(extras), merged.updatedAt, id,
  );
  return merged;
}

export async function createProviderConnection(data) {
  if (isCloud) return createProviderConnectionCloud(data);

  const now = nowIso();
  // Upsert: oauth → (provider, email); apikey → (provider, name)
  let existing = null;
  if (data.authType === "oauth" && data.email) {
    existing = db().prepare(`
      SELECT * FROM provider_connections
      WHERE provider = ? AND auth_type = 'oauth'
        AND json_extract(data, '$.email') = ?
    `).get(data.provider, data.email);
  } else if (data.authType === "apikey" && data.name) {
    existing = db().prepare(`
      SELECT * FROM provider_connections
      WHERE provider = ? AND auth_type = 'apikey' AND name = ?
    `).get(data.provider, data.name);
  }

  if (existing) {
    const current = rowToConnection(existing);
    const merged = { ...current, ...data, updatedAt: now };
    const extras = splitExtras(merged, CONN_COLS);
    db().prepare(`
      UPDATE provider_connections
      SET provider = ?, auth_type = ?, name = ?, priority = ?, is_active = ?,
          data = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.provider, merged.authType || null, merged.name ?? null,
      merged.priority ?? null, merged.isActive === false ? 0 : 1,
      JSON.stringify(extras), now, current.id,
    );
    return merged;
  }

  // New connection: derive default name + next priority
  let connectionName = data.name || null;
  if (!connectionName && data.authType === "oauth") {
    if (data.email) {
      connectionName = data.email;
    } else {
      const row = db().prepare(
        "SELECT COUNT(*) as c FROM provider_connections WHERE provider = ?",
      ).get(data.provider);
      connectionName = `Account ${(row?.c || 0) + 1}`;
    }
  }

  let priority = data.priority;
  if (!priority) {
    const row = db().prepare(
      "SELECT COALESCE(MAX(priority), 0) as m FROM provider_connections WHERE provider = ?",
    ).get(data.provider);
    priority = (row?.m || 0) + 1;
  }

  const connection = {
    id: uuidv4(),
    provider: data.provider,
    authType: data.authType || "oauth",
    name: connectionName,
    priority,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: now,
    updatedAt: now,
  };

  const optionalFields = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil",
    "expiresIn", "errorCode", "consecutiveUseCount",
  ];
  for (const f of optionalFields) {
    if (data[f] !== undefined && data[f] !== null) connection[f] = data[f];
  }
  if (data.providerSpecificData && Object.keys(data.providerSpecificData).length) {
    connection.providerSpecificData = data.providerSpecificData;
  }

  await insertConnectionRow(connection);
  await reorderProviderConnections(data.provider);
  return connection;
}

// Cloud copy of createProviderConnection — kept isolated so the SQLite
// path stays readable.
async function createProviderConnectionCloud(data) {
  const d = await getCloudDb();
  const now = nowIso();
  let idx = -1;
  if (data.authType === "oauth" && data.email) {
    idx = d.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "oauth" && c.email === data.email,
    );
  } else if (data.authType === "apikey" && data.name) {
    idx = d.data.providerConnections.findIndex(
      c => c.provider === data.provider && c.authType === "apikey" && c.name === data.name,
    );
  }
  if (idx !== -1) {
    d.data.providerConnections[idx] = { ...d.data.providerConnections[idx], ...data, updatedAt: now };
    return d.data.providerConnections[idx];
  }
  let name = data.name;
  if (!name && data.authType === "oauth") {
    name = data.email || `Account ${d.data.providerConnections.filter(c => c.provider === data.provider).length + 1}`;
  }
  let priority = data.priority;
  if (!priority) {
    const max = d.data.providerConnections
      .filter(c => c.provider === data.provider)
      .reduce((m, c) => Math.max(m, c.priority || 0), 0);
    priority = max + 1;
  }
  const connection = {
    id: uuidv4(), provider: data.provider, authType: data.authType || "oauth",
    name, priority, isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: now, updatedAt: now, ...data,
  };
  d.data.providerConnections.push(connection);
  return connection;
}

export async function updateProviderConnection(id, data) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = d.data.providerConnections.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const providerId = d.data.providerConnections[idx].provider;
    d.data.providerConnections[idx] = {
      ...d.data.providerConnections[idx], ...data, updatedAt: nowIso(),
    };
    if (data.priority !== undefined) await reorderProviderConnections(providerId);
    return d.data.providerConnections[idx];
  }

  const current = await getProviderConnectionById(id);
  if (!current) return null;
  const merged = await updateConnectionRow(id, data);
  if (data.priority !== undefined) await reorderProviderConnections(current.provider);
  return merged;
}

export async function deleteProviderConnection(id) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = d.data.providerConnections.findIndex(c => c.id === id);
    if (idx === -1) return false;
    const providerId = d.data.providerConnections[idx].provider;
    d.data.providerConnections.splice(idx, 1);
    await reorderProviderConnections(providerId);
    return true;
  }
  const current = await getProviderConnectionById(id);
  if (!current) return false;
  db().prepare("DELETE FROM provider_connections WHERE id = ?").run(id);
  await reorderProviderConnections(current.provider);
  return true;
}

export async function deleteProviderConnectionsByProvider(providerId) {
  if (isCloud) {
    const d = await getCloudDb();
    const before = d.data.providerConnections.length;
    d.data.providerConnections = d.data.providerConnections.filter(c => c.provider !== providerId);
    return before - d.data.providerConnections.length;
  }
  const r = db().prepare("DELETE FROM provider_connections WHERE provider = ?").run(providerId);
  return r.changes;
}

export async function reorderProviderConnections(providerId) {
  if (isCloud) {
    const d = await getCloudDb();
    const list = d.data.providerConnections
      .filter(c => c.provider === providerId)
      .sort((a, b) => {
        const p = (a.priority || 0) - (b.priority || 0);
        return p !== 0 ? p : new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });
    list.forEach((c, i) => { c.priority = i + 1; });
    return;
  }
  const rows = db().prepare(`
    SELECT id FROM provider_connections
    WHERE provider = ?
    ORDER BY COALESCE(priority, 0), updated_at DESC
  `).all(providerId);
  const upd = db().prepare("UPDATE provider_connections SET priority = ? WHERE id = ?");
  const runAll = db().transaction(() => {
    rows.forEach((r, i) => upd.run(i + 1, r.id));
  });
  runAll();
}

// ===== Provider Nodes ====================================================

export async function getProviderNodes(filter = {}) {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.providerNodes || [];
    if (filter.type) list = list.filter(n => n.type === filter.type);
    return list;
  }
  const clauses = [];
  const params = [];
  if (filter.type) { clauses.push("type = ?"); params.push(filter.type); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db().prepare(`SELECT * FROM provider_nodes ${where}`).all(...params);
  return rows.map(rowToNode);
}

export async function getProviderNodeById(id) {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.providerNodes.find(n => n.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM provider_nodes WHERE id = ?").get(id);
  return r ? rowToNode(r) : null;
}

export async function createProviderNode(data) {
  const now = nowIso();
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
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.providerNodes) d.data.providerNodes = [];
    d.data.providerNodes.push(node);
    return node;
  }
  const extras = splitExtras(node, NODE_COLS);
  db().prepare(`
    INSERT INTO provider_nodes
    (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id, node.type || null, node.name ?? null, node.prefix ?? null,
    node.apiType ?? null, node.baseUrl ?? null,
    JSON.stringify(extras), node.createdAt, node.updatedAt,
  );
  return node;
}

export async function updateProviderNode(id, data) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.providerNodes || []).findIndex(n => n.id === id);
    if (idx === -1) return null;
    d.data.providerNodes[idx] = { ...d.data.providerNodes[idx], ...data, updatedAt: nowIso() };
    return d.data.providerNodes[idx];
  }
  const current = await getProviderNodeById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() };
  const extras = splitExtras(merged, NODE_COLS);
  db().prepare(`
    UPDATE provider_nodes
    SET type = ?, name = ?, prefix = ?, api_type = ?, base_url = ?,
        data = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.type || null, merged.name ?? null, merged.prefix ?? null,
    merged.apiType ?? null, merged.baseUrl ?? null,
    JSON.stringify(extras), merged.updatedAt, id,
  );
  return merged;
}

export async function deleteProviderNode(id) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.providerNodes || []).findIndex(n => n.id === id);
    if (idx === -1) return null;
    const [removed] = d.data.providerNodes.splice(idx, 1);
    return removed;
  }
  const current = await getProviderNodeById(id);
  if (!current) return null;
  db().prepare("DELETE FROM provider_nodes WHERE id = ?").run(id);
  return current;
}

// ===== Proxy Pools =======================================================

export async function getProxyPools(filter = {}) {
  if (isCloud) {
    const d = await getCloudDb();
    let list = d.data.proxyPools || [];
    if (filter.isActive !== undefined) list = list.filter(p => p.isActive === filter.isActive);
    if (filter.testStatus) list = list.filter(p => p.testStatus === filter.testStatus);
    return [...list].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }
  const clauses = [];
  const params = [];
  if (filter.isActive !== undefined) { clauses.push("is_active = ?"); params.push(filter.isActive ? 1 : 0); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db().prepare(
    `SELECT * FROM proxy_pools ${where} ORDER BY updated_at DESC`,
  ).all(...params);
  let result = rows.map(rowToPool);
  if (filter.testStatus) result = result.filter(p => p.testStatus === filter.testStatus);
  return result;
}

export async function getProxyPoolById(id) {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.proxyPools || []).find(p => p.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM proxy_pools WHERE id = ?").get(id);
  return r ? rowToPool(r) : null;
}

export async function createProxyPool(data) {
  const now = nowIso();
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
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.proxyPools) d.data.proxyPools = [];
    d.data.proxyPools.push(pool);
    return pool;
  }
  const extras = splitExtras(pool, POOL_COLS);
  db().prepare(`
    INSERT INTO proxy_pools
    (id, name, proxy_url, type, is_active, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pool.id, pool.name ?? null, pool.proxyUrl ?? null, pool.type,
    pool.isActive ? 1 : 0, JSON.stringify(extras), pool.createdAt, pool.updatedAt,
  );
  return pool;
}

export async function updateProxyPool(id, data) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.proxyPools || []).findIndex(p => p.id === id);
    if (idx === -1) return null;
    d.data.proxyPools[idx] = { ...d.data.proxyPools[idx], ...data, updatedAt: nowIso() };
    return d.data.proxyPools[idx];
  }
  const current = await getProxyPoolById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() };
  const extras = splitExtras(merged, POOL_COLS);
  db().prepare(`
    UPDATE proxy_pools
    SET name = ?, proxy_url = ?, type = ?, is_active = ?, data = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.name ?? null, merged.proxyUrl ?? null, merged.type || "http",
    merged.isActive === false ? 0 : 1, JSON.stringify(extras), merged.updatedAt, id,
  );
  return merged;
}

export async function deleteProxyPool(id) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.proxyPools || []).findIndex(p => p.id === id);
    if (idx === -1) return null;
    const [removed] = d.data.proxyPools.splice(idx, 1);
    return removed;
  }
  const current = await getProxyPoolById(id);
  if (!current) return null;
  db().prepare("DELETE FROM proxy_pools WHERE id = ?").run(id);
  return current;
}

// ===== Model Aliases =====================================================

export async function getModelAliases() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.modelAliases || {};
  }
  const rows = db().prepare("SELECT alias, target FROM model_aliases").all();
  const out = {};
  for (const r of rows) out[r.alias] = r.target;
  return out;
}

export async function setModelAlias(alias, model) {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.modelAliases[alias] = model;
    return;
  }
  db().prepare(
    "INSERT OR REPLACE INTO model_aliases (alias, target) VALUES (?, ?)",
  ).run(alias, model);
}

export async function deleteModelAlias(alias) {
  if (isCloud) {
    const d = await getCloudDb();
    delete d.data.modelAliases[alias];
    return;
  }
  db().prepare("DELETE FROM model_aliases WHERE alias = ?").run(alias);
}

// ===== Custom Models =====================================================

export async function getCustomModels() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.customModels || [];
  }
  const rows = db().prepare(
    "SELECT provider_alias, id, type, name FROM custom_models"
  ).all();
  return rows.map((r) => ({
    providerAlias: r.provider_alias,
    id: r.id,
    type: r.type || "llm",
    name: r.name || r.id,
  }));
}

export async function addCustomModel({ providerAlias, id, type = "llm", name }) {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.customModels) d.data.customModels = [];
    const exists = d.data.customModels.some(
      (m) => m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type
    );
    if (exists) return false;
    d.data.customModels.push({ providerAlias, id, type, name: name || id });
    return true;
  }
  const info = db().prepare(
    "INSERT OR IGNORE INTO custom_models (provider_alias, id, type, name) VALUES (?, ?, ?, ?)"
  ).run(providerAlias, id, type, name || id);
  return info.changes > 0;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.customModels) return;
    d.data.customModels = d.data.customModels.filter(
      (m) => !(m.providerAlias === providerAlias && m.id === id && (m.type || "llm") === type)
    );
    return;
  }
  db().prepare(
    "DELETE FROM custom_models WHERE provider_alias = ? AND id = ? AND type = ?"
  ).run(providerAlias, id, type);
}

// ===== MITM Aliases ======================================================

export async function getMitmAlias(toolName) {
  if (isCloud) {
    const d = await getCloudDb();
    const all = d.data.mitmAlias || {};
    return toolName ? (all[toolName] || {}) : all;
  }
  if (toolName) {
    const r = db().prepare("SELECT data FROM mitm_aliases WHERE tool = ?").get(toolName);
    return r ? (parseExtras(r.data) || {}) : {};
  }
  const rows = db().prepare("SELECT tool, data FROM mitm_aliases").all();
  const out = {};
  for (const r of rows) out[r.tool] = parseExtras(r.data);
  return out;
}

export async function setMitmAliasAll(toolName, mappings) {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.mitmAlias) d.data.mitmAlias = {};
    d.data.mitmAlias[toolName] = mappings || {};
    return;
  }
  db().prepare(
    "INSERT OR REPLACE INTO mitm_aliases (tool, data) VALUES (?, ?)",
  ).run(toolName, JSON.stringify(mappings || {}));
}

// ===== Combos ============================================================

export async function getCombos() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.combos || [];
  }
  const rows = db().prepare("SELECT * FROM combos").all();
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.combos || []).find(c => c.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM combos WHERE id = ?").get(id);
  return r ? rowToCombo(r) : null;
}

export async function getComboByName(name) {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.combos || []).find(c => c.name === name) || null;
  }
  const r = db().prepare("SELECT * FROM combos WHERE name = ?").get(name);
  return r ? rowToCombo(r) : null;
}

export async function createCombo(data) {
  const now = nowIso();
  const combo = {
    id: uuidv4(),
    name: data.name,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.combos) d.data.combos = [];
    d.data.combos.push(combo);
    return combo;
  }
  const extras = splitExtras(combo, COMBO_COLS);
  db().prepare(`
    INSERT INTO combos (id, name, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(combo.id, combo.name ?? null, JSON.stringify(extras), combo.createdAt, combo.updatedAt);
  return combo;
}

export async function updateCombo(id, data) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.combos || []).findIndex(c => c.id === id);
    if (idx === -1) return null;
    d.data.combos[idx] = { ...d.data.combos[idx], ...data, updatedAt: nowIso() };
    return d.data.combos[idx];
  }
  const current = await getComboById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: nowIso() };
  const extras = splitExtras(merged, COMBO_COLS);
  db().prepare(`
    UPDATE combos SET name = ?, data = ?, updated_at = ? WHERE id = ?
  `).run(merged.name ?? null, JSON.stringify(extras), merged.updatedAt, id);
  return merged;
}

export async function deleteCombo(id) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.combos || []).findIndex(c => c.id === id);
    if (idx === -1) return false;
    d.data.combos.splice(idx, 1);
    return true;
  }
  const r = db().prepare("DELETE FROM combos WHERE id = ?").run(id);
  return r.changes > 0;
}

// ===== API Keys ==========================================================

export async function getApiKeys() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.apiKeys || [];
  }
  const rows = db().prepare("SELECT * FROM api_keys").all();
  return rows.map(rowToApiKey);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const now = nowIso();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: now,
  };
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.apiKeys) d.data.apiKeys = [];
    d.data.apiKeys.push(apiKey);
    return apiKey;
  }
  db().prepare(`
    INSERT INTO api_keys (id, name, key, machine_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(apiKey.id, apiKey.name, apiKey.key, apiKey.machineId, 1, apiKey.createdAt);
  return apiKey;
}

export async function deleteApiKey(id) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.apiKeys || []).findIndex(k => k.id === id);
    if (idx === -1) return false;
    d.data.apiKeys.splice(idx, 1);
    return true;
  }
  const r = db().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  return r.changes > 0;
}

export async function getApiKeyById(id) {
  if (isCloud) {
    const d = await getCloudDb();
    return (d.data.apiKeys || []).find(k => k.id === id) || null;
  }
  const r = db().prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
  return r ? rowToApiKey(r) : null;
}

export async function updateApiKey(id, data) {
  if (isCloud) {
    const d = await getCloudDb();
    const idx = (d.data.apiKeys || []).findIndex(k => k.id === id);
    if (idx === -1) return null;
    d.data.apiKeys[idx] = { ...d.data.apiKeys[idx], ...data };
    return d.data.apiKeys[idx];
  }
  const current = await getApiKeyById(id);
  if (!current) return null;
  const merged = { ...current, ...data };
  db().prepare(`
    UPDATE api_keys SET name = ?, key = ?, machine_id = ?, is_active = ?
    WHERE id = ?
  `).run(
    merged.name ?? null, merged.key, merged.machineId ?? null,
    merged.isActive === false ? 0 : 1, id,
  );
  return merged;
}

export async function validateApiKey(key) {
  if (isCloud) {
    const d = await getCloudDb();
    const found = (d.data.apiKeys || []).find(k => k.key === key);
    return !!(found && found.isActive !== false);
  }
  const r = db().prepare(
    "SELECT 1 FROM api_keys WHERE key = ? AND is_active != 0",
  ).get(key);
  return !!r;
}

// ===== Settings ==========================================================

export async function getSettings() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.settings || { cloudEnabled: false };
  }
  const rows = db().prepare("SELECT key, value FROM settings").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); }
    catch { out[r.key] = r.value; }
  }
  return out;
}

export async function updateSettings(updates) {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.settings = { ...d.data.settings, ...updates };
    return d.data.settings;
  }
  const stmt = db().prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  const runAll = db().transaction((patch) => {
    for (const [k, v] of Object.entries(patch)) {
      stmt.run(k, JSON.stringify(v));
    }
  });
  runAll(updates);
  return await getSettings();
}

// ===== Cleanup / Export / Import =========================================

export async function cleanupProviderConnections() {
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "idToken", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];

  const all = await getProviderConnections();
  let cleaned = 0;
  for (const conn of all) {
    let dirty = false;
    for (const f of fieldsToCheck) {
      if (conn[f] === null || conn[f] === undefined) {
        delete conn[f];
        dirty = true;
        cleaned++;
      }
    }
    if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
      delete conn.providerSpecificData;
      dirty = true;
      cleaned++;
    }
    if (dirty) {
      // Re-write the row with the cleaned JSON blob.
      const extras = splitExtras(conn, CONN_COLS);
      if (isCloud) continue;
      db().prepare(
        "UPDATE provider_connections SET data = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(extras), nowIso(), conn.id);
    }
  }
  return cleaned;
}

export async function exportDb() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data || cloneDefaultData();
  }
  return {
    providerConnections: await getProviderConnections(),
    providerNodes: await getProviderNodes(),
    proxyPools: await getProxyPools(),
    modelAliases: await getModelAliases(),
    mitmAlias: await getMitmAlias(),
    combos: await getCombos(),
    apiKeys: await getApiKeys(),
    settings: await getSettings(),
    pricing: await getRawPricing(),
  };
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }

  const next = {
    ...cloneDefaultData(),
    ...payload,
    settings: {
      ...cloneDefaultData().settings,
      ...(payload.settings && typeof payload.settings === "object" && !Array.isArray(payload.settings)
        ? payload.settings
        : {}),
    },
  };

  if (isCloud) {
    const d = await getCloudDb();
    d.data = next;
    return d.data;
  }

  // Wipe + bulk insert everything inside one transaction so the dashboard
  // either sees the full previous state or the full new state.
  const run = db().transaction((data) => {
    db().exec(`
      DELETE FROM provider_connections;
      DELETE FROM provider_nodes;
      DELETE FROM proxy_pools;
      DELETE FROM combos;
      DELETE FROM api_keys;
      DELETE FROM model_aliases;
      DELETE FROM mitm_aliases;
      DELETE FROM settings;
      DELETE FROM pricing;
    `);

    const connStmt = db().prepare(`
      INSERT INTO provider_connections
      (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.providerConnections || []) {
      const extras = splitExtras(c, CONN_COLS);
      connStmt.run(
        c.id || uuidv4(), c.provider, c.authType || null, c.name ?? null,
        c.priority ?? null, c.isActive === false ? 0 : 1,
        JSON.stringify(extras), c.createdAt || nowIso(), c.updatedAt || nowIso(),
      );
    }

    const nodeStmt = db().prepare(`
      INSERT INTO provider_nodes
      (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of data.providerNodes || []) {
      const extras = splitExtras(n, NODE_COLS);
      nodeStmt.run(
        n.id || uuidv4(), n.type || null, n.name ?? null, n.prefix ?? null,
        n.apiType ?? null, n.baseUrl ?? null,
        JSON.stringify(extras), n.createdAt || nowIso(), n.updatedAt || nowIso(),
      );
    }

    const poolStmt = db().prepare(`
      INSERT INTO proxy_pools
      (id, name, proxy_url, type, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.proxyPools || []) {
      const extras = splitExtras(p, POOL_COLS);
      poolStmt.run(
        p.id || uuidv4(), p.name ?? null, p.proxyUrl ?? null, p.type || "http",
        p.isActive === false ? 0 : 1, JSON.stringify(extras),
        p.createdAt || nowIso(), p.updatedAt || nowIso(),
      );
    }

    const comboStmt = db().prepare(`
      INSERT INTO combos (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const c of data.combos || []) {
      const extras = splitExtras(c, COMBO_COLS);
      comboStmt.run(
        c.id || uuidv4(), c.name ?? null, JSON.stringify(extras),
        c.createdAt || nowIso(), c.updatedAt || nowIso(),
      );
    }

    const apiKeyStmt = db().prepare(`
      INSERT INTO api_keys (id, name, key, machine_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const k of data.apiKeys || []) {
      if (!k.key) continue;
      apiKeyStmt.run(
        k.id || uuidv4(), k.name ?? null, k.key, k.machineId ?? null,
        k.isActive === false ? 0 : 1, k.createdAt || nowIso(),
      );
    }

    const aliasStmt = db().prepare(
      "INSERT INTO model_aliases (alias, target) VALUES (?, ?)",
    );
    for (const [a, t] of Object.entries(data.modelAliases || {})) {
      if (typeof t === "string") aliasStmt.run(a, t);
    }

    const mitmStmt = db().prepare(
      "INSERT INTO mitm_aliases (tool, data) VALUES (?, ?)",
    );
    for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
      mitmStmt.run(tool, JSON.stringify(mappings ?? {}));
    }

    const settingsStmt = db().prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?)",
    );
    for (const [k, v] of Object.entries(data.settings || {})) {
      settingsStmt.run(k, JSON.stringify(v));
    }

    const priceStmt = db().prepare(
      "INSERT INTO pricing (provider, model, data) VALUES (?, ?, ?)",
    );
    for (const [provider, models] of Object.entries(data.pricing || {})) {
      if (!models || typeof models !== "object") continue;
      for (const [model, p] of Object.entries(models)) {
        priceStmt.run(provider, model, JSON.stringify(p ?? {}));
      }
    }
  });
  run(next);
  return next;
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return settings.cloudUrl || process.env.CLOUD_URL || process.env.NEXT_PUBLIC_CLOUD_URL || "";
}

// ===== Pricing ===========================================================

async function getRawPricing() {
  if (isCloud) {
    const d = await getCloudDb();
    return d.data.pricing || {};
  }
  const rows = db().prepare("SELECT provider, model, data FROM pricing").all();
  const out = {};
  for (const r of rows) {
    if (!out[r.provider]) out[r.provider] = {};
    out[r.provider][r.model] = parseExtras(r.data);
  }
  return out;
}

export async function getPricing() {
  const userPricing = await getRawPricing();
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

  if (isCloud) {
    const d = await getCloudDb();
    const userPricing = d.data.pricing || {};
    if (provider && userPricing[provider]?.[model]) return userPricing[provider][model];
  } else {
    if (provider) {
      const r = db().prepare(
        "SELECT data FROM pricing WHERE provider = ? AND model = ?",
      ).get(provider, model);
      if (r) return parseExtras(r.data);
    }
  }

  const { getPricingForModel: resolve } = await import("@/shared/constants/pricing.js");
  return resolve(provider, model);
}

export async function updatePricing(pricingData) {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.pricing) d.data.pricing = {};
    for (const [provider, models] of Object.entries(pricingData)) {
      if (!d.data.pricing[provider]) d.data.pricing[provider] = {};
      for (const [model, p] of Object.entries(models)) {
        d.data.pricing[provider][model] = p;
      }
    }
    return d.data.pricing;
  }
  const stmt = db().prepare(
    "INSERT OR REPLACE INTO pricing (provider, model, data) VALUES (?, ?, ?)",
  );
  const run = db().transaction((patch) => {
    for (const [provider, models] of Object.entries(patch)) {
      for (const [model, p] of Object.entries(models)) {
        stmt.run(provider, model, JSON.stringify(p));
      }
    }
  });
  run(pricingData);
  return await getRawPricing();
}

export async function resetPricing(provider, model) {
  if (isCloud) {
    const d = await getCloudDb();
    if (!d.data.pricing) d.data.pricing = {};
    if (model) {
      if (d.data.pricing[provider]) {
        delete d.data.pricing[provider][model];
        if (Object.keys(d.data.pricing[provider]).length === 0) {
          delete d.data.pricing[provider];
        }
      }
    } else {
      delete d.data.pricing[provider];
    }
    return d.data.pricing;
  }
  if (model) {
    db().prepare("DELETE FROM pricing WHERE provider = ? AND model = ?").run(provider, model);
  } else {
    db().prepare("DELETE FROM pricing WHERE provider = ?").run(provider);
  }
  return await getRawPricing();
}

export async function resetAllPricing() {
  if (isCloud) {
    const d = await getCloudDb();
    d.data.pricing = {};
    return d.data.pricing;
  }
  db().prepare("DELETE FROM pricing").run();
  return {};
}
