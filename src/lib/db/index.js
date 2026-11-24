import { writeKeyConnections } from "./repos/keyConnectionsRepo.js";
import { publicKeyOwnership } from "../../shared/utils/keyOwnership.js";
import { endCaptureWindow } from "./logRetention.js";
import { nextSessionEpoch } from "../auth/dashboardRoles.js";
import { decryptKey, encryptKey } from "./helpers/keyEncryption.js";
import { keyVerifier } from "./helpers/keyVerifier.js";
// Public API barrel — all DB functions
import { requestLimits, REQUEST_WINDOWS } from "@/shared/utils/requestWindows.js";
import { validateKeyPolicy } from "@/shared/utils/keyPolicy.js";
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

// Settings
export {
  getSettings, updateSettings, updateDebugCaptureWindow, isCloudEnabled, getCloudUrl, exportSettings,
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
export { getPinnedKeysByConnection, KeyConnectionError } from "./repos/keyConnectionsRepo.js";
export {
  getApiKeys, getApiKeySummaries, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey, admitApiKey,
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

export { insertAuditEntry, listAuditEntries } from "./repos/auditRepo.js";
export { getProviderSummary, getProviderHealthRows, writeConnectionObservation } from "./repos/providerHealthRepo.js";
export { BUDGET_REQUEST_TIMEOUT_MS, getBudgetLedger, validBudgetUsage } from "./repos/budgetLedger.js";
export { getNotificationsRepo } from "./repos/notificationsRepo.js";
export { getUsageReports } from "./repos/usageAnalyticsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map(row => ({
      id: row.id,
      ...publicKeyOwnership(row),
      key: decryptKey(db, row),
      name: row.name,
      machineId: row.machineId,
      isActive: row.isActive === 1,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      budget: row.budget ? JSON.parse(row.budget) : null,
      ...requestLimits(row),
      requestCounters: Object.fromEntries(REQUEST_WINDOWS.map(window => [
        window.name,
        { bucket: row[window.bucket], used: row[window.used] },
      ])),
      access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
      allowedConnections: JSON.parse(row.allowedConnections ?? "[]"),
      connectionProviders: JSON.parse(row.connectionProviders ?? "{}"),
    })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // A settings dump omits financial history. Never replenish a metered key by
    // restoring its policy without its ledger; use a full SQLite backup.
    if ((payload.apiKeys || []).some(k => k.budget != null) ||
        db.get("SELECT 1 AS found FROM apiKeys WHERE budget IS NOT NULL LIMIT 1") ||
        db.get("SELECT 1 AS found FROM budgetReservations LIMIT 1")) {
      throw new Error("Metered keys require a full SQLite backup/restore");
    }
    if (db.get("SELECT 1 FROM retiredKeyFingerprints LIMIT 1")) {
      throw new Error("Rotated keys require a full SQLite backup/restore");
    }
    const epoch = nextSessionEpoch(parseJson(db.get("SELECT data FROM settings WHERE id = 1")?.data, {}));
    endCaptureWindow(db);
    // Replace configuration, preserving local history.
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, [stringifyJson({ ...payload.settings, debugBodyLoggingUntil: null, sessionEpoch: epoch })]);

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
      const policy = validateKeyPolicy(k);
      if (policy.error) throw new Error(policy.error);
      const cols = keyAccessToColumns(access);
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key_ciphertext, key_verifier, name, machineId, isActive, createdAt, accessRestricted, accessAllow, rpmLimit, hourlyRequestLimit, dailyRequestLimit, monthlyRequestLimit, expiresAt, description, owner, project) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, encryptKey(db, k.id, 1, k.key), keyVerifier(k.key), k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow, policy.value.rpmLimit ?? null, policy.value.hourlyRequestLimit ?? null, policy.value.dailyRequestLimit ?? null, policy.value.monthlyRequestLimit ?? null, policy.value.expiresAt ?? null, policy.value.description ?? null, policy.value.owner ?? null, policy.value.project ?? null]
      );
      if (k.allowedConnections !== undefined) {
        writeKeyConnections(db, k.id, k.allowedConnections, k.connectionProviders);
      }
      if (k.requestCounters !== undefined) {
        for (const w of REQUEST_WINDOWS) {
          const counter = k.requestCounters?.[w.name];
          if (!counter || !Number.isSafeInteger(counter.bucket) || counter.bucket < -1 ||
              counter.bucket > w.at(253402300799999) || !Number.isSafeInteger(counter.used) || counter.used < 0 ||
              (counter.bucket === -1 && counter.used !== 0)) throw new Error("Invalid request counter: " + w.name);
          db.run(`UPDATE apiKeys SET ${w.bucket}=?, ${w.used}=? WHERE id=?`, [counter.bucket, counter.used, k.id]);
        }
      }
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
