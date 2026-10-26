// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { keyAccessFromColumns, keyAccessToColumns, validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { validateDestinationInput, checkDestinationCapacity } from "@/lib/webhooks/validation.js";
import { exportWebhookDestinationsRaw } from "./repos/webhooksRepo.js";
import { resetWebhookOutboxSync } from "./repos/webhookDeliveriesRepo.js";

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

// Webhook destinations
export {
  listWebhookDestinations, getWebhookDestinationById, getWebhookDestinationRawById,
  exportWebhookDestinationsRaw, createWebhookDestination, updateWebhookDestination,
  deleteWebhookDestination,
} from "./repos/webhooksRepo.js";

export {
  enqueueWebhookEvent, enqueueWebhookTest, claimNextWebhookDelivery,
  getWebhookDeliveryDestination, completeWebhookDelivery, cancelWebhookDeliveries,
  pruneWebhookDeliveries, resetWebhookOutbox, listWebhookDeliveries,
} from "./repos/webhookDeliveriesRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, access: keyAccessFromColumns(r.accessRestricted, r.accessAllow) })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
    webhooks: await exportWebhookDestinationsRaw(),
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
  validateImportSections(payload);
  const webhooks = validateImportedWebhooks(payload.webhooks);
  // Prepare every binding (including JSON and API-key access) before any write.
  const statements = [];
  const add = (sql, params) => {
    if (params.some((value) => value !== null && typeof value !== "string"
      && !(typeof value === "number" && Number.isFinite(value)))) {
      throw new Error("Invalid database field");
    }
    statements.push([sql, params]);
  };

  if (payload.settings) {
    add(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
  }

  for (const c of payload.providerConnections || []) {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    add(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const n of payload.providerNodes || []) {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    add(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const p of payload.proxyPools || []) {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    add(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }
  for (const k of payload.apiKeys || []) {
    // Legacy backups without access retain unrestricted API-key behavior.
    let access = KEY_ACCESS_UNRESTRICTED;
    if (k.access !== undefined) {
      const checked = validateKeyAccessInput(k.access);
      if (!checked.ok) throw new Error(`apiKeys ${k.id}: ${checked.error}`);
      access = checked.value;
    }
    const cols = keyAccessToColumns(access);
    add(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), cols.accessRestricted, cols.accessAllow]
    );
  }
  for (const c of payload.combos || []) {
    add(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }
  for (const [a, m] of Object.entries(payload.modelAliases || {})) {
    add(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
  }
  for (const m of payload.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    add(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
    add(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(payload.pricing || {})) {
    add(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
  }
  for (const { id, revision, createdAt, updatedAt, value } of webhooks) {
    const { enabled, ...data } = value;
    add(`INSERT INTO webhookDestinations(id, revision, data, enabled, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, revision, stringifyJson(data), enabled === false ? 0 : 1, createdAt, updatedAt]);
  }

  const db = await getAdapter();
  const { getWebhookDispatcher } = await import("@/lib/webhooks/dispatcher.js");
  const controller = getWebhookDispatcher();
  const running = controller?.isRunning() === true;
  const paused = controller?.isPaused() === true;
  try {
    if (running) {
      controller.pause();
      // Abort sockets synchronously; a sender ignoring abort cannot delay import.
      for (const { id } of db.all(`SELECT id FROM webhookDestinations UNION SELECT destinationId AS id FROM webhookDeliveries`)) {
        controller.abortDestination(id);
      }
    }
    db.transaction(() => {
      resetWebhookOutboxSync(db);
      db.run(`DELETE FROM webhookDestinations WHERE id IS NOT NULL`);
      for (const table of ["settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos"]) {
        db.run(`DELETE FROM ${table}`);
      }
      db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);
      for (const [sql, params] of statements) db.run(sql, params);
    });
    db.flush();
  } finally {
    if (running && !paused) controller.resume();
  }
  return await exportDb();
}

function validateImportSections(payload) {
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  for (const section of ["settings", "modelAliases", "mitmAlias", "pricing"]) {
    if (payload[section] !== undefined && !record(payload[section])) throw new Error(`Invalid ${section}`);
  }
  for (const section of ["providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "customModels"]) {
    const rows = payload[section];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`Invalid ${section}`);
    const ids = new Set();
    for (const row of rows) {
      if (!record(row) || !text(row.id)) throw new Error(`Invalid ${section} id`);
      const id = section === "customModels" ? `${row.providerAlias}|${row.id}|${row.type || "llm"}` : row.id;
      if (ids.has(id)) throw new Error(`Invalid ${section} id`);
      ids.add(id);
      if (section === "providerConnections" && !text(row.provider)) throw new Error("Invalid provider");
      if (section === "apiKeys" && !text(row.key)) throw new Error("Invalid API key");
      if (section === "combos" && (!text(row.name) || (row.models !== undefined && !Array.isArray(row.models)))) {
        throw new Error("Invalid combo");
      }
      if (section === "customModels" && !text(row.providerAlias)) throw new Error("Invalid custom model provider");
      if (row.isActive !== undefined && typeof row.isActive !== "boolean") throw new Error("Invalid isActive");
    }
  }
}

function validateImportedWebhooks(input = []) {
  if (!Array.isArray(input) || !checkDestinationCapacity(input.length).ok) throw new Error("Invalid webhooks");
  const ids = new Set();
  return input.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid webhook destination");
    const { id, revision, createdAt, updatedAt, ...config } = raw;
    if (typeof id !== "string" || !id.trim() || ids.has(id)
      || !Number.isSafeInteger(revision) || revision < 1
      || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))
      || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
      throw new Error("Invalid webhook metadata");
    }
    ids.add(id);
    if (config.signingSecret === null && config.kind !== "generic") delete config.signingSecret;
    const checked = validateDestinationInput(config, { mode: "create" });
    if (!checked.ok || (config.kind === "generic" && !checked.value.signingSecret)) {
      throw new Error("Invalid webhook configuration");
    }
    return { id, revision, createdAt, updatedAt, value: checked.value };
  });
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
