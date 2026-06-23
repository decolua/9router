// Public API barrel — all DB functions
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { exportSettings } from "./repos/settingsRepo.js";

type JsonObject = { [key: string]: JsonValue };

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
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey,
  validateApiKey, resolveApiKeyRecord,
} from "./repos/apiKeysRepo.js";

// Files (OpenAI Files API storage)
export {
  createFile, getFile, listFiles, deleteFile, getFileContent,
} from "./repos/filesRepo.js";

// MCP gateway: upstream instances, gateway API keys, per-key grants
export {
  getInstances, getInstanceById, getInstanceBySlug, getEnabledInstancesByIds,
  createInstance, updateInstance, deleteInstance,
} from "./repos/mcpInstancesRepo.js";
export {
  getGatewayKeys, getGatewayKeyById, createGatewayKey, deleteGatewayKey,
  validateGatewayKey, getGrantsForKey, getGrantsForKeyDetailed, setGrants,
} from "./repos/mcpGatewayRepo.js";

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
  getMonthlyUsageForKey, getMonthlyUsageBreakdownForKey,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./repos/requestDetailsRepo.js";


// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();

  const out: {
    settings: JsonObject;
    providerConnections: JsonObject[];
    providerNodes: JsonObject[];
    proxyPools: JsonObject[];
    apiKeys: JsonObject[];
    combos: JsonObject[];
    modelAliases: JsonObject;
    customModels: JsonValue[];
    mitmAlias: JsonObject;
    pricing: JsonObject;
  } = {
    settings: await exportSettings() as JsonObject,
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r["data"] as string | null, {} as JsonObject), id: r["id"] as JsonValue, provider: r["provider"] as JsonValue, authType: r["authType"] as JsonValue, name: r["name"] as JsonValue, email: r["email"] as JsonValue, priority: r["priority"] as JsonValue, isActive: r["isActive"] === 1, createdAt: r["createdAt"] as JsonValue, updatedAt: r["updatedAt"] as JsonValue })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r["data"] as string | null, {} as JsonObject), id: r["id"] as JsonValue, type: r["type"] as JsonValue, name: r["name"] as JsonValue, createdAt: r["createdAt"] as JsonValue, updatedAt: r["updatedAt"] as JsonValue })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r["data"] as string | null, {} as JsonObject), id: r["id"] as JsonValue, isActive: r["isActive"] === 1, testStatus: r["testStatus"] as JsonValue, createdAt: r["createdAt"] as JsonValue, updatedAt: r["updatedAt"] as JsonValue })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r["id"] as JsonValue, key: r["key"] as JsonValue, name: r["name"] as JsonValue, machineId: r["machineId"] as JsonValue, isActive: r["isActive"] === 1, createdAt: r["createdAt"] as JsonValue })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r["id"] as JsonValue, name: r["name"] as JsonValue, kind: r["kind"] as JsonValue, models: parseJson(r["models"] as string | null, [] as JsonValue[]), createdAt: r["createdAt"] as JsonValue, updatedAt: r["updatedAt"] as JsonValue })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r["key"] as string] = parseJson(r["value"] as string | null);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r["value"] as string | null));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r["key"] as string] = parseJson(r["value"] as string | null);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r["key"] as string] = parseJson(r["value"] as string | null);

  return out;
}

export async function importDb(payload: JsonValue) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const p: JsonObject = payload as JsonObject;
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
    if (p["settings"]) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(p["settings"])]);
    }

    for (const c of (p["providerConnections"] as JsonObject[] | undefined) ?? []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType ?? "oauth", name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, stringifyJson(rest as JsonObject), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()]
      );
    }
    for (const n of (p["providerNodes"] as JsonObject[] | undefined) ?? []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type ?? null, name ?? null, stringifyJson(rest as JsonObject), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()]
      );
    }
    for (const pp of (p["proxyPools"] as JsonObject[] | undefined) ?? []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = pp;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus ?? "unknown", stringifyJson(rest as JsonObject), createdAt ?? new Date().toISOString(), updatedAt ?? new Date().toISOString()]
      );
    }
    for (const k of (p["apiKeys"] as JsonObject[] | undefined) ?? []) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [k["id"], k["key"], k["name"] ?? null, k["machineId"] ?? null, k["isActive"] === false ? 0 : 1, k["createdAt"] ?? new Date().toISOString()]
      );
    }
    for (const c of (p["combos"] as JsonObject[] | undefined) ?? []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c["id"], c["name"], c["kind"] ?? null, stringifyJson((c["models"] ?? []) as JsonValue), c["createdAt"] ?? new Date().toISOString(), c["updatedAt"] ?? new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries((p["modelAliases"] as JsonObject | undefined) ?? {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of (p["customModels"] as JsonObject[] | undefined) ?? []) {
      const k = `${m["providerAlias"]}|${m["id"]}|${m["type"] ?? "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m as JsonObject)]);
    }
    for (const [tool, mappings] of Object.entries((p["mitmAlias"] as JsonObject | undefined) ?? {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings ?? {})]);
    }
    for (const [provider, models] of Object.entries((p["pricing"] as JsonObject | undefined) ?? {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models ?? {})]);
    }
  });

  return exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
