import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";

const legacyPricingKv = makeKv("pricing");
const modelPricingKv = makeKv("modelPricing");
const pricingMappingKv = makeKv("pricingMappings");
const pricingMetaKv = makeKv("pricingMeta");
const CACHE_TTL_MS = 5000;

let cache = { value: null, expiresAt: 0 };
let migrationPromise = null;

const mappingKey = (provider, model) =>
  `${encodeURIComponent(provider)}|${encodeURIComponent(model)}`;

const parseMappingKey = (key) => {
  const separator = key.indexOf("|");
  if (separator < 0) return null;
  return {
    provider: decodeURIComponent(key.slice(0, separator)),
    model: decodeURIComponent(key.slice(separator + 1)),
  };
};

function invalidate() {
  cache = { value: null, expiresAt: 0 };
}

function comparable(value) {
  if (!value || typeof value !== "object") return value;
  const { lastUpdated, ...rest } = value;
  return rest;
}

async function getLegacyUserPricing() {
  return await legacyPricingKv.getAll();
}

async function migrateLegacyPricing() {
  if (await pricingMetaKv.get("legacyMigrated", false)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const marker = db.get(`SELECT value FROM kv WHERE scope = 'pricingMeta' AND key = 'legacyMigrated'`);
    if (marker && parseJson(marker.value, false)) return;

    const rows = db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`);
    const selected = new Map();
    const mappings = [];
    for (const row of rows) {
      const provider = row.key;
      const models = parseJson(row.value, {}) || {};
      for (const [model, pricing] of Object.entries(models)) {
        if (!model || !pricing || typeof pricing !== "object") continue;
        const previous = selected.get(model);
        if (!previous || provider === "opencode-go") {
          selected.set(model, {
            ...pricing,
            source: provider === "opencode-go" ? "opencode" : "migration",
          });
        }
        mappings.push({ provider, model, pricingModel: model });
      }
    }

    for (const [model, pricing] of selected) {
      db.run(
        `INSERT OR IGNORE INTO kv(scope, key, value) VALUES('modelPricing', ?, ?)`,
        [model, stringifyJson(pricing)],
      );
    }
    for (const mapping of mappings) {
      db.run(
        `INSERT OR IGNORE INTO kv(scope, key, value) VALUES('pricingMappings', ?, ?)`,
        [mappingKey(mapping.provider, mapping.model), stringifyJson(mapping.pricingModel)],
      );
    }
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES('pricingMeta', 'legacyMigrated', ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [stringifyJson(true)],
    );
  });
}

async function ensureMigrated() {
  if (!migrationPromise) migrationPromise = migrateLegacyPricing().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  await migrationPromise;
}

export async function getPricingModels() {
  await ensureMigrated();
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) return cache.value;
  const models = await modelPricingKv.getAll();
  cache = { value: models, expiresAt: now + CACHE_TTL_MS };
  return models;
}

export async function upsertPricingModels(models) {
  await ensureMigrated();
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [model, pricing] of Object.entries(models || {})) {
      if (!model || !pricing || typeof pricing !== "object" || Array.isArray(pricing)) continue;
      const row = db.get(`SELECT value FROM kv WHERE scope = 'modelPricing' AND key = ?`, [model]);
      const previous = row ? (parseJson(row.value, {}) || {}) : {};
      const changed = JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(pricing));
      const next = changed
        ? { ...previous, ...pricing, lastUpdated: now }
        : { ...previous, ...pricing, lastUpdated: previous.lastUpdated || pricing.lastUpdated || "" };
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('modelPricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [model, stringifyJson(next)],
      );
    }
  });
  invalidate();
  return await getPricingModels();
}

export async function deletePricingModel(model) {
  await ensureMigrated();
  const db = await getAdapter();
  db.transaction(() => {
    db.run(`DELETE FROM kv WHERE scope = 'modelPricing' AND key = ?`, [model]);
    const rows = db.all(`SELECT key, value FROM kv WHERE scope = 'pricingMappings'`);
    for (const row of rows) {
      if (parseJson(row.value) === model) {
        db.run(`DELETE FROM kv WHERE scope = 'pricingMappings' AND key = ?`, [row.key]);
      }
    }
  });
  invalidate();
  return await getPricingModels();
}

export async function getPricingMappings() {
  await ensureMigrated();
  const all = await pricingMappingKv.getAll();
  return Object.entries(all).flatMap(([key, pricingModel]) => {
    const identity = parseMappingKey(key);
    return identity && typeof pricingModel === "string"
      ? [{ ...identity, pricingModel }]
      : [];
  });
}

export async function setPricingMappings(mappings) {
  await ensureMigrated();
  const normalized = (Array.isArray(mappings) ? mappings : [])
    .map((item) => ({
      provider: String(item?.provider || "").trim(),
      model: String(item?.model || "").trim(),
      pricingModel: String(item?.pricingModel || "").trim(),
    }))
    .filter((item) => item.provider && item.model && item.pricingModel);
  const db = await getAdapter();
  db.transaction(() => {
    for (const item of normalized) {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricingMappings', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [mappingKey(item.provider, item.model), stringifyJson(item.pricingModel)],
      );
    }
  });
  return await getPricingMappings();
}

export async function replacePricingMappings(pricingModel, models) {
  await ensureMigrated();
  const target = String(pricingModel || "").trim();
  const normalized = (Array.isArray(models) ? models : [])
    .map((item) => ({ provider: String(item?.provider || "").trim(), model: String(item?.model || "").trim() }))
    .filter((item) => item.provider && item.model);
  const db = await getAdapter();
  db.transaction(() => {
    const rows = db.all(`SELECT key, value FROM kv WHERE scope = 'pricingMappings'`);
    for (const row of rows) {
      if (parseJson(row.value) === target) db.run(`DELETE FROM kv WHERE scope = 'pricingMappings' AND key = ?`, [row.key]);
    }
    for (const item of normalized) {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricingMappings', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [mappingKey(item.provider, item.model), stringifyJson(target)],
      );
    }
  });
  return await getPricingMappings();
}

export async function deletePricingMapping(provider, model) {
  await pricingMappingKv.remove(mappingKey(provider, model));
}

export async function getPricingForModel(provider, model) {
  if (!model) return null;
  const models = await getPricingModels();
  if (Object.keys(models).length) {
    const mapping = await pricingMappingKv.get(mappingKey(provider || "", model));
    if (mapping && models[mapping]) return models[mapping];
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    return settings.defaultPricingModel ? (models[settings.defaultPricingModel] || null) : null;
  }

  // Compatibility fallback for installations that have not configured global pricing yet.
  const userPricing = await getLegacyUserPricing();
  if (provider && userPricing[provider]?.[model]) return userPricing[provider][model];
  const { getPricingForModel: resolveConst } = await import("open-sse/providers/pricing.js");
  return resolveConst(provider, model);
}

// Legacy provider-scoped API retained for backup compatibility and older callers.
export async function getPricing() {
  const userPricing = await getLegacyUserPricing();
  const { PROVIDER_PRICING } = await import("open-sse/providers/pricing.js");
  const merged = {};
  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) merged[provider] = { ...models };
  for (const [provider, models] of Object.entries(userPricing)) {
    merged[provider] ||= {};
    for (const [model, pricing] of Object.entries(models || {})) {
      merged[provider][model] = merged[provider][model]
        ? { ...merged[provider][model], ...pricing }
        : pricing;
    }
  }
  return merged;
}

export async function updatePricing(pricingData) {
  const db = await getAdapter();
  db.transaction(() => {
    for (const [provider, models] of Object.entries(pricingData || {})) {
      const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      const current = row ? (parseJson(row.value, {}) || {}) : {};
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson({ ...current, ...models })],
      );
    }
  });
  migrationPromise = null;
  return await getLegacyUserPricing();
}

export async function resetPricing(provider, model) {
  if (!provider) return await getLegacyUserPricing();
  const db = await getAdapter();
  db.transaction(() => {
    if (!model) {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    const current = row ? (parseJson(row.value, {}) || {}) : {};
    delete current[model];
    if (Object.keys(current).length) {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [provider, stringifyJson(current)],
      );
    } else {
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    }
  });
  migrationPromise = null;
  return await getLegacyUserPricing();
}

export async function resetAllPricing() {
  await legacyPricingKv.clear();
  migrationPromise = null;
  return {};
}
