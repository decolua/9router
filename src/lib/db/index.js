// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { upsertSql } from "./helpers/upsert.js";

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
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
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
    providerConnections: (await db.all(`SELECT * FROM providerConnections`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: (await db.all(`SELECT * FROM providerNodes`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: (await db.all(`SELECT * FROM proxyPools`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: (await db.all(`SELECT * FROM apiKeys`)).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: (await db.all(`SELECT * FROM combos`)).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of await db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  const connUpsert = upsertSql("providerConnections", ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"], ["id"]);
  const nodeUpsert = upsertSql("providerNodes", ["id", "type", "name", "data", "createdAt", "updatedAt"], ["id"]);
  const poolUpsert = upsertSql("proxyPools", ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"], ["id"]);
  const keyUpsert = upsertSql("apiKeys", ["id", "key", "name", "machineId", "isActive", "createdAt"], ["id"]);
  const comboUpsert = upsertSql("combos", ["id", "name", "kind", "models", "createdAt", "updatedAt"], ["id"]);
  const kvUpsert = upsertSql("kv", ["scope", "key", "value"], ["scope", "key"]);

  await db.transaction(async () => {
    // Wipe all tables (keep _meta)
    await db.run(`DELETE FROM settings`);
    await db.run(`DELETE FROM providerConnections`);
    await db.run(`DELETE FROM providerNodes`);
    await db.run(`DELETE FROM proxyPools`);
    await db.run(`DELETE FROM apiKeys`);
    await db.run(`DELETE FROM combos`);
    await db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      await db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      await db.run(connUpsert,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      await db.run(nodeUpsert,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      await db.run(poolUpsert,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      await db.run(keyUpsert,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of payload.combos || []) {
      await db.run(comboUpsert,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      await db.run(kvUpsert, ["modelAliases", a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      await db.run(kvUpsert, ["customModels", k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      await db.run(kvUpsert, ["mitmAlias", tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      await db.run(kvUpsert, ["pricing", provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}

// ⚠️ DESTRUCTIVE — wipes every data table. `_meta` (schema version) is kept so
// the schema is not re-migrated; the lifetime request counter is reset to 0.
// Intended for dev/testing DBs. The API route that calls this is JWT-protected,
// password-gated, and disabled in production unless ALLOW_DB_RESET=true.
export async function resetDb({ keepSettings = false } = {}) {
  const db = await getAdapter();

  // Order doesn't matter — TRUNCATE with no FKs. RESTART IDENTITY resets the
  // usageHistory BIGSERIAL. Unquoted names fold to lower-case, matching storage.
  const tables = [
    "providerConnections",
    "providerNodes",
    "proxyPools",
    "apiKeys",
    "combos",
    "kv",
    "usageHistory",
    "usageDaily",
    "requestDetails",
  ];
  if (!keepSettings) tables.push("settings");

  await db.transaction(async () => {
    await db.exec(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY`);
    await db.run(`UPDATE _meta SET value = '0' WHERE key = 'totalRequestsLifetime'`);
  });

  // Bust in-memory caches so the dashboard doesn't show stale rows/counters.
  try {
    global._recentRing = { items: [], initialized: false };
    global._connectionMapCache = { map: {}, ts: 0 };
    global._pendingRequests = { byModel: {}, byAccount: {} };
  } catch { /* not running under the app */ }

  return { cleared: tables, keptSettings: keepSettings };
}
