// One-shot migration: import legacy lowdb JSON files into SQLite.
// Called from connection.js on first boot (when `meta.schema_version` is
// missing). Runs each file's import in its own transaction; on success the
// original JSON is renamed to `*.bak` so rollback is a rename-back away.

import fs from "node:fs";
import path from "node:path";

const DB_JSON = "db.json";
const USAGE_JSON = "usage.json";
const REQUEST_DETAILS_JSON = "request-details.json";

const STRUCTURED_CONN_FIELDS = new Set([
  "id", "provider", "authType", "name", "priority", "isActive",
  "createdAt", "updatedAt",
]);

const STRUCTURED_NODE_FIELDS = new Set([
  "id", "type", "name", "prefix", "apiType", "baseUrl",
  "createdAt", "updatedAt",
]);

const STRUCTURED_POOL_FIELDS = new Set([
  "id", "name", "proxyUrl", "type", "isActive", "createdAt", "updatedAt",
]);

const STRUCTURED_COMBO_FIELDS = new Set([
  "id", "name", "createdAt", "updatedAt",
]);

function pickExtraAsJson(obj, structured) {
  const extras = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!structured.has(k)) extras[k] = v;
  }
  return JSON.stringify(extras);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[sqlite] could not parse ${filePath}, skipping:`, err.message);
    return null;
  }
}

function renameToBak(filePath) {
  try {
    fs.renameSync(filePath, `${filePath}.bak`);
  } catch (err) {
    console.warn(`[sqlite] could not rename ${filePath} → .bak:`, err.message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function importConfigDb(db, data) {
  let imported = 0;

  if (Array.isArray(data.providerConnections)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO provider_connections
      (id, provider, auth_type, name, priority, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.providerConnections) {
      if (!c?.id || !c.provider) continue;
      stmt.run(
        c.id,
        c.provider,
        c.authType || null,
        c.name ?? null,
        c.priority ?? null,
        c.isActive === false ? 0 : 1,
        pickExtraAsJson(c, STRUCTURED_CONN_FIELDS),
        c.createdAt || nowIso(),
        c.updatedAt || c.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.providerNodes)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO provider_nodes
      (id, type, name, prefix, api_type, base_url, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of data.providerNodes) {
      if (!n?.id) continue;
      stmt.run(
        n.id,
        n.type || null,
        n.name ?? null,
        n.prefix ?? null,
        n.apiType ?? null,
        n.baseUrl ?? null,
        pickExtraAsJson(n, STRUCTURED_NODE_FIELDS),
        n.createdAt || nowIso(),
        n.updatedAt || n.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.proxyPools)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO proxy_pools
      (id, name, proxy_url, type, is_active, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of data.proxyPools) {
      if (!p?.id) continue;
      stmt.run(
        p.id,
        p.name ?? null,
        p.proxyUrl ?? null,
        p.type || "http",
        p.isActive === false ? 0 : 1,
        pickExtraAsJson(p, STRUCTURED_POOL_FIELDS),
        p.createdAt || nowIso(),
        p.updatedAt || p.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.combos)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO combos
      (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const c of data.combos) {
      if (!c?.id) continue;
      stmt.run(
        c.id,
        c.name ?? null,
        pickExtraAsJson(c, STRUCTURED_COMBO_FIELDS),
        c.createdAt || nowIso(),
        c.updatedAt || c.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (Array.isArray(data.apiKeys)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO api_keys
      (id, name, key, machine_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const k of data.apiKeys) {
      if (!k?.id || !k.key) continue;
      stmt.run(
        k.id,
        k.name ?? null,
        k.key,
        k.machineId ?? null,
        k.isActive === false ? 0 : 1,
        k.createdAt || nowIso(),
      );
      imported++;
    }
  }

  if (data.modelAliases && typeof data.modelAliases === "object") {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO model_aliases (alias, target) VALUES (?, ?)",
    );
    for (const [alias, target] of Object.entries(data.modelAliases)) {
      if (typeof target !== "string") continue;
      stmt.run(alias, target);
      imported++;
    }
  }

  if (data.mitmAlias && typeof data.mitmAlias === "object") {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO mitm_aliases (tool, data) VALUES (?, ?)",
    );
    for (const [tool, mappings] of Object.entries(data.mitmAlias)) {
      stmt.run(tool, JSON.stringify(mappings ?? {}));
      imported++;
    }
  }

  if (Array.isArray(data.customModels)) {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO custom_models (provider_alias, id, type, name) VALUES (?, ?, ?, ?)",
    );
    for (const m of data.customModels) {
      if (!m?.providerAlias || !m?.id) continue;
      stmt.run(m.providerAlias, m.id, m.type || "llm", m.name || m.id);
      imported++;
    }
  }

  if (data.settings && typeof data.settings === "object") {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    for (const [k, v] of Object.entries(data.settings)) {
      stmt.run(k, JSON.stringify(v));
      imported++;
    }
  }

  if (data.pricing && typeof data.pricing === "object") {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO pricing (provider, model, data) VALUES (?, ?, ?)",
    );
    for (const [provider, models] of Object.entries(data.pricing)) {
      if (!models || typeof models !== "object") continue;
      for (const [model, priceObj] of Object.entries(models)) {
        stmt.run(provider, model, JSON.stringify(priceObj ?? {}));
        imported++;
      }
    }
  }

  return imported;
}

function importUsageDb(db, data) {
  let imported = 0;

  if (Array.isArray(data.history)) {
    const stmt = db.prepare(`
      INSERT INTO usage_history
      (timestamp, provider, model, connection_id, api_key, endpoint, status,
       prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of data.history) {
      if (!e?.timestamp) continue;
      const t = e.tokens || {};
      const prompt = t.prompt_tokens ?? t.input_tokens ?? 0;
      const completion = t.completion_tokens ?? t.output_tokens ?? 0;
      const rest = {};
      for (const [k, v] of Object.entries(e)) {
        if (!["timestamp", "provider", "model", "connectionId", "apiKey",
              "endpoint", "status", "tokens", "cost"].includes(k)) {
          rest[k] = v;
        }
      }
      rest.tokens = t;
      stmt.run(
        e.timestamp,
        e.provider || null,
        e.model || null,
        e.connectionId || null,
        typeof e.apiKey === "string" ? e.apiKey : null,
        e.endpoint || null,
        e.status || null,
        prompt,
        completion,
        e.cost || 0,
        JSON.stringify(rest),
      );
      imported++;
    }
  }

  if (typeof data.totalRequestsLifetime === "number") {
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('totalRequestsLifetime', ?)",
    ).run(String(data.totalRequestsLifetime));
  }

  if (data.dailySummary && typeof data.dailySummary === "object") {
    const dayStmt = db.prepare(`
      INSERT OR REPLACE INTO daily_summary
      (date_key, bucket, key, requests, prompt_tokens, completion_tokens, cost, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [dateKey, day] of Object.entries(data.dailySummary)) {
      if (!day || typeof day !== "object") continue;
      dayStmt.run(
        dateKey, "day", "_",
        day.requests || 0,
        day.promptTokens || 0,
        day.completionTokens || 0,
        day.cost || 0,
        null,
      );
      for (const bucket of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
        const obj = day[bucket];
        if (!obj || typeof obj !== "object") continue;
        for (const [k, v] of Object.entries(obj)) {
          const { requests, promptTokens, completionTokens, cost, ...meta } = v || {};
          dayStmt.run(
            dateKey, bucket, k,
            requests || 0,
            promptTokens || 0,
            completionTokens || 0,
            cost || 0,
            Object.keys(meta).length ? JSON.stringify(meta) : null,
          );
        }
      }
      imported++;
    }
  }

  return imported;
}

function importRequestDetails(db, data) {
  if (!Array.isArray(data.records)) return 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO request_details
    (id, timestamp, provider, model, connection_id, status, latency_ms,
     prompt_tokens, completion_tokens, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  for (const r of data.records) {
    if (!r?.id) continue;
    const latency = typeof r.latency === "number"
      ? r.latency
      : (r.latency?.total ?? r.latency?.totalMs ?? null);
    const t = r.tokens || {};
    const rest = { ...r };
    delete rest.id;
    delete rest.timestamp;
    delete rest.provider;
    delete rest.model;
    delete rest.connectionId;
    delete rest.status;
    stmt.run(
      r.id,
      r.timestamp || nowIso(),
      r.provider || null,
      r.model || null,
      r.connectionId || null,
      r.status || null,
      latency,
      t.prompt_tokens ?? t.input_tokens ?? null,
      t.completion_tokens ?? t.output_tokens ?? null,
      JSON.stringify(rest),
    );
    imported++;
  }
  return imported;
}

// Public entry — runs inside the caller's transaction scope if wrapped.
// Each legacy file is imported in its own transaction so a corrupt file
// doesn't block the others.
export function migrateFromJson(db, dataDir) {
  const summary = { imported: 0, files: [] };

  const cfgPath = path.join(dataDir, DB_JSON);
  const cfg = readJson(cfgPath);
  if (cfg) {
    const count = db.transaction(() => importConfigDb(db, cfg)).immediate();
    summary.imported += count;
    summary.files.push({ file: DB_JSON, rows: count });
    renameToBak(cfgPath);
  }

  const usagePath = path.join(dataDir, USAGE_JSON);
  const usage = readJson(usagePath);
  if (usage) {
    const count = db.transaction(() => importUsageDb(db, usage)).immediate();
    summary.imported += count;
    summary.files.push({ file: USAGE_JSON, rows: count });
    renameToBak(usagePath);
  }

  const rdPath = path.join(dataDir, REQUEST_DETAILS_JSON);
  const rd = readJson(rdPath);
  if (rd) {
    const count = db.transaction(() => importRequestDetails(db, rd)).immediate();
    summary.imported += count;
    summary.files.push({ file: REQUEST_DETAILS_JSON, rows: count });
    renameToBak(rdPath);
  }

  return summary;
}
