// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey, recordApiKeyUsageInWindow,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
 } from "./repos/aliasRepo.js";

 // Model overrides + custom model (studio) virtual models
export {
  getStudioModels, getStudioModel, setStudioModel, deleteStudioModel,
  getModelOverrides, setModelOverride, deleteModelOverride,
} from "./repos/modelEditorRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      machineId: r.machineId,
      isActive: r.isActive === 1,
      createdAt: r.createdAt,
      tokenLimit: r.tokenLimit,
      usedTokens: r.usedTokens,
      resetInterval: r.resetInterval,
      lastResetAt: r.lastResetAt,
      allowedModels: r.allowedModels,
      rpmLimit: r.rpmLimit,
      tpmLimit: r.tpmLimit,
      ipWhitelist: r.ipWhitelist,
      expiresAt: r.expiresAt || null,
      systemPrompt: r.systemPrompt || "",
    })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id`),
    usageDaily: db.all(`SELECT * FROM usageDaily`),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    modelOverrides: {},
    pricing: {},
    disabledModels: {},
    autoBackup: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelOverrides'`)) out.modelOverrides[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'disabledModels'`)) out.disabledModels[r.key] = parseJson(r.value, []);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'autoBackup'`)) out.autoBackup[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  // Snapshot existing apiKeys BEFORE wiping, so we can fill in missing fields from backup
  const existingApiKeys = {};
  for (const r of db.all(`SELECT * FROM apiKeys`)) {
    existingApiKeys[r.id] = r;
  }

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM usageHistory`);
    db.run(`DELETE FROM usageDaily`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing', 'modelOverrides', 'disabledModels', 'autoBackup')`);
    // requestDetails (observability request log) is intentionally NOT part of the
    // export payload — it is a large, auto-pruned log (see db/backup.js). It is
    // wiped here so a restore never leaves stale request rows mixed in with the
    // restored data.
    db.run(`DELETE FROM requestDetails`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      // Merge with existing data: if a field was missing from backup (old format), keep the previous value
      const prev = existingApiKeys[k.id] || {};
      const tokenLimit = k.tokenLimit !== undefined ? Number(k.tokenLimit) : (prev.tokenLimit !== undefined ? Number(prev.tokenLimit) : 0);
      const usedTokens = k.usedTokens !== undefined ? Number(k.usedTokens) : (prev.usedTokens !== undefined ? Number(prev.usedTokens) : 0);
      const resetInterval = k.resetInterval !== undefined ? k.resetInterval : (prev.resetInterval || "never");
      const lastResetAt = k.lastResetAt !== undefined ? k.lastResetAt : (prev.lastResetAt || null);
      const allowedModels = k.allowedModels !== undefined ? k.allowedModels : (prev.allowedModels || "*");
      const rpmLimit = k.rpmLimit !== undefined ? Number(k.rpmLimit) : (prev.rpmLimit !== undefined ? Number(prev.rpmLimit) : 0);
      const tpmLimit = k.tpmLimit !== undefined ? Number(k.tpmLimit) : (prev.tpmLimit !== undefined ? Number(prev.tpmLimit) : 0);
      const ipWhitelist = k.ipWhitelist !== undefined ? k.ipWhitelist : (prev.ipWhitelist || "");
 const expiresAt = k.expiresAt !== undefined ? k.expiresAt : (prev.expiresAt || null);
 const systemPrompt = k.systemPrompt !== undefined ? k.systemPrompt : (prev.systemPrompt || "");

      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenLimit, usedTokens, resetInterval, lastResetAt, allowedModels, rpmLimit, tpmLimit, ipWhitelist, expiresAt, systemPrompt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id,
          k.key,
          k.name || null,
          k.machineId || null,
          k.isActive === false ? 0 : 1,
          k.createdAt || new Date().toISOString(),
          tokenLimit,
          usedTokens,
          resetInterval,
          lastResetAt,
          allowedModels,
          rpmLimit,
          tpmLimit,
          ipWhitelist,
 expiresAt,
 systemPrompt,
]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const h of payload.usageHistory || []) {
      db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.timestamp || new Date().toISOString(),
          h.provider || null,
          h.model || null,
          h.connectionId || null,
          h.apiKey || null,
          h.endpoint || null,
          h.promptTokens || 0,
          h.completionTokens || 0,
          h.cost || 0,
          h.status || null,
          h.tokens || null,
          h.meta || null,
        ]
      );
    }
    for (const d of payload.usageDaily || []) {
      db.run(
        `INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`,
        [d.dateKey, typeof d.data === "string" ? d.data : stringifyJson(d.data)]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
        for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
    for (const [k, v] of Object.entries(payload.modelOverrides || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelOverrides', ?, ?)`, [k, stringifyJson(v)]);
    }
    for (const [key, value] of Object.entries(payload.autoBackup || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('autoBackup', ?, ?)`, [key, stringifyJson(value)]);
    }
    // `disabledModels` (repos/disabledModelsRepo.js) uses the same (scope, key) upsert
    // that repo writes with. payload.disabledModels is optional: a backup produced
    // before this key existed imports as a no-op instead of failing.
    for (const [provider, ids] of Object.entries(payload.disabledModels || {})) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES('disabledModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [provider, stringifyJson(ids || [])]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
