// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { stampInsert, stampUpsertConflict } from "../federation/stamp.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
  requireApiKeyPinnedBy,
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
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
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

  // Tombstone filter only where the column exists: tables created before the
  // federation migration (or by partial legacy fixtures) have no `deleted`
  // column and cannot hold tombstones, so the plain SELECT is already honest.
  const hasDeletedCol = (table) => db.all(`PRAGMA table_info(${table})`).some((c) => c.name === "deleted");
  const rep = (table) => (hasDeletedCol(table) ? `SELECT * FROM ${table} WHERE (deleted = 0 OR deleted IS NULL)` : `SELECT * FROM ${table}`);

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(rep("providerConnections")).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt, federation_version: r.federation_version ?? 0, updated_at: r.updated_at ?? null, deleted: r.deleted ?? 0 })),
    providerNodes: db.all(rep("providerNodes")).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, federation_version: r.federation_version ?? 0, updated_at: r.updated_at ?? null, deleted: r.deleted ?? 0 })),
    proxyPools: db.all(rep("proxyPools")).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt, federation_version: r.federation_version ?? 0, updated_at: r.updated_at ?? null, deleted: r.deleted ?? 0 })),
    apiKeys: db.all(rep("apiKeys")).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, federation_version: r.federation_version ?? 0, updated_at: r.updated_at ?? null, deleted: r.deleted ?? 0, access: keyAccessFromColumns(r.accessRestricted, r.accessAllow) })),
    combos: db.all(rep("combos")).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt, federation_version: r.federation_version ?? 0, updated_at: r.updated_at ?? null, deleted: r.deleted ?? 0 })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  const kvDel = hasDeletedCol("kv") ? ` AND (deleted = 0 OR deleted IS NULL)` : "";
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'${kvDel}`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'${kvDel}`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'${kvDel}`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'${kvDel}`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      // FED-022: stamp the restore seed so the settings row is delta-visible
      // (unstamped federation_version = NULL is excluded by `federation_version > since`).
      // On a pre-FED-001 schema the stamp columns do not exist yet; restore
      // plainly — the federation migration stamps on its next boot.
      const settingsCols = new Set(db.all(`PRAGMA table_info(settings)`).map((c) => c.name));
      if (settingsCols.has("federation_version")) {
        const s = stampInsert(db);
        db.run(
          `INSERT INTO settings(id, data${s.cols}) VALUES(1, ?${s.placeholders}) ON CONFLICT(id) DO UPDATE SET data = excluded.data${stampUpsertConflict()}`,
          [stringifyJson(payload.settings), ...s.params]
        );
      } else {
        db.run(
          `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
          [stringifyJson(payload.settings)]
        );
      }
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
      // Per-key access: a backup without `access` (older version) restores
      // unrestricted, exactly as before; a malformed `access` is refused.
      let access = KEY_ACCESS_UNRESTRICTED;
      if (k.access !== undefined) {
        const checked = validateKeyAccessInput(k.access);
        if (!checked.ok) throw new Error(`apiKeys ${k.id}: ${checked.error}`);
        access = checked.value;
      }
      const cols = keyAccessToColumns(access);
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
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
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
