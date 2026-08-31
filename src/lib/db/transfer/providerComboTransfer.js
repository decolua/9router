import { randomUUID } from "node:crypto";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { findMatchingProviderConnection } from "../repos/connectionsRepo.js";

export const TRANSFER_FORMAT = "9router-provider-combo-transfer";
export const TRANSFER_VERSION = 1;
const SOURCE_VERSION = process.env.npm_package_version || null;

const COMBO_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const MAX_ITEMS = 5000;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const TRANSIENT_CONNECTION_FIELDS = new Set([
  "testStatus", "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil",
  "errorCode", "consecutiveUseCount", "lastRefreshAt", "modelLocks",
]);
const TARGET_PROXY_FIELDS = new Set([
  "proxyPoolId", "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
]);

function fail(message) {
  throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function asArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > MAX_ITEMS) fail(`${label} exceeds the ${MAX_ITEMS}-item limit`);
  return value;
}

function assertUnique(items, keyFor, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) fail(`${label} contains duplicate identity: ${key}`);
    seen.add(key);
  }
}

function connectionFromRow(row) {
  return {
    ...parseJson(row.data, {}),
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeFromRow(row) {
  return {
    ...parseJson(row.data, {}),
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function comboFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function flattenDataObject(value) {
  if (typeof value?.data !== "string") return { ...(value || {}) };
  const { data, ...columns } = value;
  return { ...parseJson(data, {}), ...columns };
}

export function sanitizeConnection(value) {
  const connection = flattenDataObject(asObject(value, "Provider connection"));
  if (!connection.id || !connection.provider) fail("Provider connection requires id and provider");
  const clean = { ...connection, authType: connection.authType || "oauth" };
  delete clean.priority;
  delete clean.isActive;
  delete clean.createdAt;
  delete clean.updatedAt;
  for (const field of TRANSIENT_CONNECTION_FIELDS) delete clean[field];
  if (clean.providerSpecificData && typeof clean.providerSpecificData === "object") {
    clean.providerSpecificData = { ...clean.providerSpecificData };
    for (const field of TARGET_PROXY_FIELDS) delete clean.providerSpecificData[field];
    if (Object.keys(clean.providerSpecificData).length === 0) delete clean.providerSpecificData;
  }
  return clean;
}

function sanitizeNode(value) {
  const node = flattenDataObject(asObject(value, "Provider node"));
  if (!node.id) fail("Provider node requires id");
  delete node.createdAt;
  delete node.updatedAt;
  return node;
}

function sanitizeCombo(value) {
  const combo = asObject(value, "Combo");
  if (!combo.id || !combo.name || !COMBO_NAME_PATTERN.test(combo.name)) fail("Combo requires a valid id and name");
  const models = asArray(combo.models, `Models for combo ${combo.name}`);
  if (models.some((model) => typeof model !== "string" || !model.trim())) fail(`Combo ${combo.name} has an invalid model`);
  return { id: combo.id, name: combo.name, kind: combo.kind || null, models: models.map((model) => model.trim()) };
}

function sanitizeAliases(value) {
  const aliases = value === undefined ? {} : asObject(value, "Model aliases");
  const clean = {};
  for (const [key, target] of Object.entries(aliases)) {
    if (typeof key !== "string" || !key.trim() || typeof target !== "string" || !target.trim()) {
      fail("Model aliases must contain non-empty string keys and values");
    }
    clean[key.trim()] = target.trim();
  }
  return clean;
}

function sanitizeCustomModels(value) {
  return asArray(value, "Custom models").map((model) => {
    asObject(model, "Custom model");
    if (!model.providerAlias || !model.id) fail("Custom model requires providerAlias and id");
    return {
      providerAlias: String(model.providerAlias),
      id: String(model.id),
      type: String(model.type || "llm"),
      name: String(model.name || model.id),
    };
  });
}

function referencedModelStrings(combos) {
  return new Set(combos.flatMap((combo) => combo.models));
}

function referencedPrefixes(models, aliases, customModels) {
  const prefixes = new Set();
  const collect = (model) => {
    if (typeof model === "string" && model.includes("/")) prefixes.add(model.split("/", 1)[0]);
  };
  for (const model of models) collect(model);
  for (const [key, target] of Object.entries(aliases)) {
    if (models.has(key) || models.has(target)) collect(target);
  }
  for (const model of customModels) {
    if (models.has(`${model.providerAlias}/${model.id}`) || models.has(model.id)) prefixes.add(model.providerAlias);
  }
  return prefixes;
}

function dependencySubset({ providerConnections, providerNodes, combos, modelAliases, customModels }) {
  const models = referencedModelStrings(combos);
  const aliases = Object.fromEntries(Object.entries(modelAliases).filter(([key, value]) => models.has(key) || models.has(value)));
  const custom = customModels.filter((model) => models.has(`${model.providerAlias}/${model.id}`) || models.has(model.id));
  const prefixes = referencedPrefixes(models, aliases, custom);
  const providerIds = new Set(providerConnections.map((connection) => connection.provider));
  const nodes = providerNodes.filter((node) => providerIds.has(node.id) || (node.prefix && prefixes.has(node.prefix)));
  return { providerConnections, providerNodes: nodes, combos, modelAliases: aliases, customModels: custom };
}

export function parseTransferPayload(input) {
  const raw = Array.isArray(input) ? { providerConnections: input } : asObject(input, "Transfer payload");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_PAYLOAD_BYTES) fail("Transfer payload exceeds the 10 MB limit");
  if (raw.format && (raw.format !== TRANSFER_FORMAT || raw.version !== TRANSFER_VERSION)) {
    fail("Unsupported selective-transfer format or version");
  }
  const providerConnections = asArray(raw.providerConnections, "Provider connections").map(sanitizeConnection);
  const providerNodes = asArray(raw.providerNodes, "Provider nodes").map(sanitizeNode);
  const combos = asArray(raw.combos, "Combos").map(sanitizeCombo);
  const comboStrategies = raw.comboStrategies === undefined
    ? (raw.settings?.comboStrategies || {})
    : asObject(raw.comboStrategies, "Combo strategies");
  const modelAliases = sanitizeAliases(raw.modelAliases);
  const customModels = sanitizeCustomModels(raw.customModels);
  assertUnique(providerConnections, (item) => item.id, "Provider connections");
  assertUnique(providerNodes, (item) => item.id, "Provider nodes");
  assertUnique(combos, (item) => item.id, "Combos");
  assertUnique(combos, (item) => item.name, "Combos");
  assertUnique(customModels, customModelKey, "Custom models");
  const scoped = dependencySubset({ providerConnections, providerNodes, combos, modelAliases, customModels });
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    sourceVersion: raw.sourceVersion || null,
    exportedAt: raw.exportedAt || null,
    ...scoped,
    comboStrategies: Object.fromEntries(scoped.combos
      .filter((combo) => comboStrategies[combo.name] && typeof comboStrategies[combo.name] === "object")
      .map((combo) => [combo.name, comboStrategies[combo.name]])),
  };
}

function readAliases(db) {
  return Object.fromEntries(db.all("SELECT key, value FROM kv WHERE scope = 'modelAliases'")
    .map((row) => [row.key, parseJson(row.value, "")]
    ).filter(([, value]) => typeof value === "string"));
}

function readCustomModels(db) {
  return db.all("SELECT value FROM kv WHERE scope = 'customModels'").map((row) => parseJson(row.value, null)).filter(Boolean);
}

function readSettings(db) {
  const row = db.get("SELECT data FROM settings WHERE id = 1");
  return row ? parseJson(row.data, {}) : {};
}

export function getTransferCatalogFromDb(db) {
  return {
    providerConnections: db.all("SELECT * FROM providerConnections ORDER BY provider, priority, name")
      .map(connectionFromRow)
      .map(({ id, provider, authType, name, email }) => ({ id, provider, authType, name, email })),
    combos: db.all("SELECT * FROM combos ORDER BY name").map(comboFromRow)
      .map(({ id, name, kind, models }) => ({ id, name, kind, modelCount: models.length })),
  };
}

export function createTransferBundleFromDb(db, selection = {}) {
  const providerIds = new Set(asArray(selection.providerConnectionIds, "Selected provider IDs").map(String));
  const comboIds = new Set(asArray(selection.comboIds, "Selected combo IDs").map(String));
  if (providerIds.size === 0 && comboIds.size === 0) fail("Select at least one provider account or combo");

  const providerConnections = db.all("SELECT * FROM providerConnections")
    .map(connectionFromRow).filter((connection) => providerIds.has(connection.id)).map(sanitizeConnection);
  const combos = db.all("SELECT * FROM combos").map(comboFromRow).filter((combo) => comboIds.has(combo.id)).map(sanitizeCombo);
  if (providerConnections.length !== providerIds.size) fail("One or more selected provider accounts no longer exist");
  if (combos.length !== comboIds.size) fail("One or more selected combos no longer exist");

  const allNodes = db.all("SELECT * FROM providerNodes").map(nodeFromRow).map(sanitizeNode);
  const allAliases = readAliases(db);
  const allCustomModels = readCustomModels(db);
  const scoped = dependencySubset({ providerConnections, providerNodes: allNodes, combos, modelAliases: allAliases, customModels: allCustomModels });
  const settings = readSettings(db);
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    sourceVersion: SOURCE_VERSION,
    exportedAt: new Date().toISOString(),
    ...scoped,
    comboStrategies: Object.fromEntries(combos
      .filter((combo) => settings.comboStrategies?.[combo.name])
      .map((combo) => [combo.name, settings.comboStrategies[combo.name]])),
  };
}

function nodePortable(node) {
  const { id, name, ...rest } = node;
  return { name: name || null, ...rest };
}

function nodePlan(db, payload) {
  const existing = db.all("SELECT * FROM providerNodes").map(nodeFromRow).map(sanitizeNode);
  return payload.providerNodes.map((source) => {
    const byId = existing.find((target) => target.id === source.id);
    const byPrefix = source.prefix ? existing.find((target) => target.prefix === source.prefix) : null;
    const target = byId || byPrefix || null;
    const status = !target ? "new" : stable(nodePortable(target)) === stable(nodePortable(source)) ? "identical" : "conflict";
    return {
      sourceId: source.id,
      targetId: target?.id || source.id,
      name: source.name || source.prefix || source.id,
      prefix: source.prefix || null,
      status,
      recommended: status === "new" ? "add" : "keep",
    };
  });
}

function remapProvider(provider, nodes) {
  return nodes.find((node) => node.sourceId === provider)?.targetId || provider;
}

function findConnectionMatch(existing, source) {
  const idMatch = existing.find((target) => target.id === source.id);
  if (idMatch) return idMatch;
  const sharedMatch = findMatchingProviderConnection(existing, source);
  if (sharedMatch) return sharedMatch;
  if (source.authType === "access_token" && source.accessToken) {
    return existing.find((target) => target.provider === source.provider && target.authType === source.authType && target.accessToken === source.accessToken) || null;
  }
  return null;
}

function connectionComparable(connection) {
  const clean = sanitizeConnection(connection);
  delete clean.id;
  return clean;
}

function connectionPlan(db, payload, nodes) {
  const existing = db.all("SELECT * FROM providerConnections").map(connectionFromRow).map(sanitizeConnection);
  return payload.providerConnections.map((original) => {
    const source = { ...original, provider: remapProvider(original.provider, nodes) };
    const idCollision = existing.find((target) => target.id === source.id && (target.provider !== source.provider || target.authType !== source.authType));
    const target = idCollision || findConnectionMatch(existing, source);
    const status = idCollision
      ? "ambiguous"
      : !target
        ? "new"
        : stable(connectionComparable(target)) === stable(connectionComparable(source)) ? "identical" : "conflict";
    return {
      sourceId: original.id,
      targetId: target?.id || null,
      provider: source.provider,
      authType: source.authType,
      label: source.name || source.email || `${source.provider} account`,
      status,
      recommended: status === "new" ? "add" : "skip",
    };
  });
}

function comboPlan(db, payload) {
  const existing = db.all("SELECT * FROM combos").map(comboFromRow);
  const aliases = readAliases(db);
  const settings = readSettings(db);
  return payload.combos.map((source) => {
    const target = existing.find((combo) => combo.name === source.name) || null;
    const aliasCollision = Object.prototype.hasOwnProperty.call(aliases, source.name);
    const sourceStrategy = payload.comboStrategies[source.name] || null;
    const targetStrategy = target ? settings.comboStrategies?.[target.name] || null : null;
    const status = aliasCollision && !target
      ? "name_conflict"
      : !target
        ? "new"
        : stable({ kind: target.kind || null, models: target.models, strategy: targetStrategy }) === stable({ kind: source.kind || null, models: source.models, strategy: sourceStrategy })
          ? "identical" : "conflict";
    return {
      sourceId: source.id,
      targetId: target?.id || null,
      name: source.name,
      kind: source.kind,
      modelCount: source.models.length,
      status,
      recommended: status === "new" ? "add" : "skip",
    };
  });
}

function aliasPlan(db, payload) {
  const existing = readAliases(db);
  return Object.entries(payload.modelAliases).map(([key, value]) => ({
    key,
    value,
    status: existing[key] === undefined ? "new" : existing[key] === value ? "identical" : "conflict",
    recommended: existing[key] === undefined ? "add" : "skip",
  }));
}

function customModelKey(model) {
  return `${model.providerAlias}|${model.id}|${model.type || "llm"}`;
}

function customModelPlan(db, payload) {
  const existing = new Map(readCustomModels(db).map((model) => [customModelKey(model), model]));
  return payload.customModels.map((model) => {
    const key = customModelKey(model);
    const target = existing.get(key);
    return {
      key,
      model,
      status: !target ? "new" : stable(target) === stable(model) ? "identical" : "conflict",
      recommended: !target ? "add" : "skip",
    };
  });
}

export function planTransferFromDb(db, input) {
  const payload = parseTransferPayload(input);
  const providerNodes = nodePlan(db, payload);
  const providerConnections = connectionPlan(db, payload, providerNodes);
  const combos = comboPlan(db, payload);
  const modelAliases = aliasPlan(db, payload);
  const customModels = customModelPlan(db, payload);
  const all = [...providerNodes, ...providerConnections, ...combos, ...modelAliases, ...customModels];
  const counts = all.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  return {
    format: payload.format,
    version: payload.version,
    sourceVersion: payload.sourceVersion,
    summary: {
      providerConnections: providerConnections.length,
      combos: combos.length,
      providerNodes: providerNodes.length,
      modelAliases: modelAliases.length,
      customModels: customModels.length,
      counts,
      deletions: 0,
    },
    providerConnections,
    combos,
    dependencies: { providerNodes, modelAliases, customModels },
  };
}

function dataColumns(value, columns) {
  const rest = { ...value };
  for (const column of columns) delete rest[column];
  return rest;
}

function targetProxyFields(connection) {
  const source = connection.providerSpecificData || {};
  return Object.fromEntries([...TARGET_PROXY_FIELDS].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function targetRuntimeFields(connection) {
  return Object.fromEntries([...TRANSIENT_CONNECTION_FIELDS]
    .filter((key) => connection[key] !== undefined)
    .map((key) => [key, connection[key]]));
}

function validAction(action, allowed, fallback) {
  return allowed.includes(action) ? action : fallback;
}

function importNode(db, source, targetId, now, replace) {
  const data = dataColumns(source, ["id", "type", "name"]);
  if (replace) {
    db.run("UPDATE providerNodes SET type = ?, name = ?, data = ?, updatedAt = ? WHERE id = ?", [source.type || null, source.name || null, stringifyJson(data), now, targetId]);
  } else {
    db.run("INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", [targetId, source.type || null, source.name || null, stringifyJson(data), now, now]);
  }
}

export function applyTransferToDb(db, input, resolutions = {}) {
  const payload = parseTransferPayload(input);
  let result;
  db.transaction(() => {
    const plan = planTransferFromDb(db, payload);
    const now = new Date().toISOString();
    const applied = { providerConnections: 0, combos: 0, providerNodes: 0, modelAliases: 0, customModels: 0, skipped: 0 };

    for (const item of plan.dependencies.providerNodes) {
      const source = payload.providerNodes.find((node) => node.id === item.sourceId);
      const requested = resolutions[`node:${item.sourceId}`]?.action;
      const action = validAction(requested, ["add", "keep", "replace", "skip"], item.recommended);
      if (action === "add" && item.status === "new") {
        importNode(db, source, item.targetId, now, false);
        applied.providerNodes++;
      } else if (action === "replace" && item.targetId) {
        importNode(db, source, item.targetId, now, true);
        applied.providerNodes++;
      } else applied.skipped++;
    }

    for (const item of plan.providerConnections) {
      const original = payload.providerConnections.find((connection) => connection.id === item.sourceId);
      const source = { ...original, provider: item.provider };
      const requested = resolutions[`provider:${item.sourceId}`]?.action;
      const action = validAction(requested, ["add", "replace", "skip"], item.recommended);
      if (action === "add" && item.status === "new") {
        const collision = db.get("SELECT id FROM providerConnections WHERE id = ?", [source.id]);
        const id = collision ? randomUUID() : source.id;
        const max = db.get("SELECT MAX(priority) AS priority FROM providerConnections WHERE provider = ?", [source.provider]);
        const priority = Number(max?.priority || 0) + 1;
        const data = dataColumns(source, ["id", "provider", "authType", "name", "email"]);
        db.run("INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)", [id, source.provider, source.authType, source.name || null, source.email || null, priority, stringifyJson(data), now, now]);
        applied.providerConnections++;
      } else if (action === "replace" && item.targetId && item.status !== "ambiguous") {
        const targetRow = db.get("SELECT * FROM providerConnections WHERE id = ?", [item.targetId]);
        const target = connectionFromRow(targetRow);
        const data = dataColumns(source, ["id", "provider", "authType", "name", "email"]);
        const proxy = targetProxyFields(target);
        if (Object.keys(proxy).length > 0) data.providerSpecificData = { ...(data.providerSpecificData || {}), ...proxy };
        Object.assign(data, targetRuntimeFields(target));
        db.run("UPDATE providerConnections SET provider = ?, authType = ?, name = ?, email = ?, data = ?, updatedAt = ? WHERE id = ?", [source.provider, source.authType, source.name || null, source.email || null, stringifyJson(data), now, item.targetId]);
        applied.providerConnections++;
      } else applied.skipped++;
    }

    for (const item of plan.dependencies.modelAliases) {
      const requested = resolutions[`alias:${item.key}`]?.action;
      const action = validAction(requested, ["add", "replace", "skip"], item.recommended);
      if ((action === "add" && item.status === "new") || action === "replace") {
        db.run("INSERT INTO kv(scope, key, value) VALUES('modelAliases', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [item.key, stringifyJson(item.value)]);
        applied.modelAliases++;
      } else applied.skipped++;
    }

    for (const item of plan.dependencies.customModels) {
      const requested = resolutions[`custom:${item.key}`]?.action;
      const action = validAction(requested, ["add", "replace", "skip"], item.recommended);
      if ((action === "add" && item.status === "new") || action === "replace") {
        db.run("INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value", [item.key, stringifyJson(item.model)]);
        applied.customModels++;
      } else applied.skipped++;
    }

    const settings = readSettings(db);
    const comboStrategies = { ...(settings.comboStrategies || {}) };
    for (const item of plan.combos) {
      const source = payload.combos.find((combo) => combo.id === item.sourceId);
      const resolution = resolutions[`combo:${item.sourceId}`] || {};
      const action = validAction(resolution.action, ["add", "replace", "merge", "rename", "skip"], item.recommended);
      let targetName = source.name;
      if (action === "rename") {
        targetName = String(resolution.renameTo || "").trim();
        if (!COMBO_NAME_PATTERN.test(targetName)) fail(`Combo ${source.name} requires a valid new name`);
        if (db.get("SELECT id FROM combos WHERE name = ?", [targetName])) fail(`Combo name already exists: ${targetName}`);
      }
      if ((action === "add" && item.status === "new") || action === "rename") {
        const collision = db.get("SELECT id FROM combos WHERE id = ?", [source.id]);
        db.run("INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)", [collision ? randomUUID() : source.id, targetName, source.kind, stringifyJson(source.models), now, now]);
        const strategy = payload.comboStrategies[source.name];
        if (strategy) comboStrategies[targetName] = strategy;
        applied.combos++;
      } else if (action === "replace" && item.targetId) {
        db.run("UPDATE combos SET kind = ?, models = ?, updatedAt = ? WHERE id = ?", [source.kind, stringifyJson(source.models), now, item.targetId]);
        const strategy = payload.comboStrategies[source.name];
        if (strategy) comboStrategies[source.name] = strategy;
        else delete comboStrategies[source.name];
        applied.combos++;
      } else if (action === "merge" && item.targetId) {
        const target = comboFromRow(db.get("SELECT * FROM combos WHERE id = ?", [item.targetId]));
        const models = [...target.models, ...source.models.filter((model) => !target.models.includes(model))];
        db.run("UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?", [stringifyJson(models), now, item.targetId]);
        applied.combos++;
      } else applied.skipped++;
    }
    settings.comboStrategies = comboStrategies;
    db.run("INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", [stringifyJson(settings)]);
    result = { success: true, applied, deletions: 0 };
  });
  return result;
}
