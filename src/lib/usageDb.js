import { EventEmitter } from "events";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { getProviderConnections, getApiKeys, getPricing } from "@/lib/localDb.js";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

function getAppName() {
  if (isCloud) return "9router";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootPkgPath = path.resolve(__dirname, "../../../package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    return pkg.config?.appName || "9router";
  } catch {
    return "9router";
  }
}

function getUserDataDir() {
  if (isCloud) return "/tmp";
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  try {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appName = getAppName();
    if (platform === "win32") {
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
    } else {
      return path.join(homeDir, `.${appName}`);
    }
  } catch (error) {
    return path.join(process.cwd(), ".9router");
  }
}

const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "usage.sqlite");
const OLD_JSON_FILE = isCloud ? null : path.join(DATA_DIR, "usage.json");
const LOG_FILE = isCloud ? null : path.join(DATA_DIR, "log.txt");

if (!isCloud && fs && typeof fs.existsSync === "function") {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error("[usageDb] Failed to create data directory:", error.message);
  }
}

// -----------------------------------------------------------------------------
// IN-MEMORY STATE (Unchanged)
// -----------------------------------------------------------------------------
let dbInstance = null;
let DatabaseCtor = null;

if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
const pendingRequests = global._pendingRequests;

if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
const lastErrorProvider = global._lastErrorProvider;

if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
export const statsEmitter = global._statsEmitter;

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));

  if (connectionId) {
    const accountKey = connectionId;
    if (!pendingRequests.byAccount[accountKey]) pendingRequests.byAccount[accountKey] = {};
    if (!pendingRequests.byAccount[accountKey][modelKey]) pendingRequests.byAccount[accountKey][modelKey] = 0;
    pendingRequests.byAccount[accountKey][modelKey] = Math.max(0, pendingRequests.byAccount[accountKey][modelKey] + (started ? 1 : -1));
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  statsEmitter.emit("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  let connectionMap = {};
  try {
    const allConnections = await getProviderConnections();
    for (const conn of allConnections) connectionMap[conn.id] = conn.name || conn.email || conn.id;
  } catch { }

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        const modelName = match ? match[1] : modelKey;
        const providerName = match ? match[2] : "unknown";
        activeRequests.push({ model: modelName, provider: providerName, account: accountName, count });
      }
    }
  }

  const db = await getUsageDb();
  let recentRequests = [];
  if (!isCloud && typeof db.prepare === "function") {
    recentRequests = db.prepare(`SELECT * FROM usage ORDER BY timestamp DESC LIMIT 20`).all().map(e => ({
      timestamp: new Date(e.timestamp).toISOString(),
      model: e.model,
      provider: e.provider || "",
      promptTokens: e.prompt_tokens,
      completionTokens: e.completion_tokens,
      status: e.status || "ok"
    }));
  }

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

// -----------------------------------------------------------------------------
// SQLITE SETUP & MIGRATION
// -----------------------------------------------------------------------------
async function getDatabaseCtor() {
  if (DatabaseCtor) return DatabaseCtor;
  if (typeof Bun !== "undefined") {
    const bunSqlite = await (new Function("return import('bun:sqlite')")());
    DatabaseCtor = bunSqlite.Database;
    return DatabaseCtor;
  }
  const betterSqlite3 = await import("better-sqlite3");
  DatabaseCtor = betterSqlite3.default;
  return DatabaseCtor;
}

function prepareStatement(db, sql) {
  if (typeof db.prepare === "function") return db.prepare(sql);
  if (typeof db.query === "function") return db.query(sql);
  throw new Error("Unsupported SQLite client");
}

function applyPragmas(db) {
  if (typeof db.pragma === "function") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("temp_store = MEMORY");
    return;
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
}

export async function getUsageDb() {
  if (isCloud) {
    if (!dbInstance) dbInstance = { prepare: () => ({ run: () => {}, get: () => null, all: () => [] }), exec: () => {} };
    return dbInstance;
  }

  if (!dbInstance) {
    const DbCtor = await getDatabaseCtor();
    const db = new DbCtor(DB_FILE);
    applyPragmas(db);

    db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT,
        model TEXT,
        connection_id TEXT,
        api_key TEXT,
        endpoint TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT DEFAULT 'ok',
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        cached_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        tokens_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage(provider);
      CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);
      CREATE INDEX IF NOT EXISTS idx_usage_connection ON usage(connection_id);
      CREATE INDEX IF NOT EXISTS idx_usage_endpoint ON usage(endpoint);
      CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage(api_key);
    `);

    // Migrate old usage.json if present
    if (fs.existsSync(OLD_JSON_FILE)) {
      console.log("[usageDb] Migrating usage.json to SQLite...");
      try {
        const oldData = JSON.parse(fs.readFileSync(OLD_JSON_FILE, "utf-8"));
        if (oldData && Array.isArray(oldData.history)) {
          const insertStmt = prepareStatement(db, `
            INSERT INTO usage (
              provider, model, connection_id, api_key, endpoint, timestamp, status,
              prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
              cache_creation_tokens, cost, tokens_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          const transaction = db.transaction((history) => {
            for (const item of history) {
              const t = item.tokens || {};
              insertStmt.run(
                item.provider || null,
                item.model || null,
                item.connectionId || null,
                item.apiKey || null,
                item.endpoint || null,
                item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
                item.status || 'ok',
                t.prompt_tokens || t.input_tokens || 0,
                t.completion_tokens || t.output_tokens || 0,
                t.cached_tokens || t.cache_read_input_tokens || 0,
                t.reasoning_tokens || 0,
                t.cache_creation_input_tokens || 0,
                item.cost || 0,
                JSON.stringify(t)
              );
            }
          });
          transaction(oldData.history);
          console.log(`[usageDb] Successfully migrated ${oldData.history.length} records to SQLite.`);
          fs.renameSync(OLD_JSON_FILE, `${OLD_JSON_FILE}.migrated`);
        }
      } catch (err) {
        console.error("[usageDb] Failed to migrate usage.json:", err);
      }
    }

    dbInstance = db;
  }
  return dbInstance;
}

// -----------------------------------------------------------------------------
// COST CALCULATION
// -----------------------------------------------------------------------------
function calculateCostSync(provider, model, tokens, pricingMap) {
  if (!tokens || !provider || !model || !pricingMap) return 0;
  try {
    const providerPricing = pricingMap[provider] || {};
    const defaultInstance = pricingMap["default"] || {};
    const pricing = providerPricing[model] || defaultInstance[model] || null;
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

    cost += (nonCachedInput * (pricing.input / 1000000));
    if (cachedTokens > 0) cost += (cachedTokens * ((pricing.cached || pricing.input) / 1000000));
    
    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += (outputTokens * (pricing.output / 1000000));
    
    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) cost += (reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000));
    
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) cost += (cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000));

    return cost;
  } catch { return 0; }
}

// -----------------------------------------------------------------------------
// CORE USAGE LOGIC
// -----------------------------------------------------------------------------
export async function saveRequestUsage(entry) {
  if (isCloud) return;
  try {
    const db = await getUsageDb();
    const pricingMap = await getPricing();
    const cost = calculateCostSync(entry.provider, entry.model, entry.tokens, pricingMap);

    const t = entry.tokens || {};
    const prompt = t.prompt_tokens || t.input_tokens || 0;
    const comp = t.completion_tokens || t.output_tokens || 0;
    const cached = t.cached_tokens || t.cache_read_input_tokens || 0;
    const reason = t.reasoning_tokens || 0;
    const cacheCreate = t.cache_creation_input_tokens || 0;

    const stmt = prepareStatement(db, `
      INSERT INTO usage (
        provider, model, connection_id, api_key, endpoint, timestamp, status,
        prompt_tokens, completion_tokens, cached_tokens, reasoning_tokens,
        cache_creation_tokens, cost, tokens_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.provider || null,
      entry.model || null,
      entry.connectionId || null,
      entry.apiKey || null,
      entry.endpoint || null,
      entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      entry.status || 'ok',
      prompt, comp, cached, reason, cacheCreate, cost, JSON.stringify(t)
    );

    statsEmitter.emit("update");
  } catch (error) {
    console.error("Failed to save usage stats:", error);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getUsageDb();
  if (isCloud) return [];

  let query = "SELECT * FROM usage WHERE 1=1";
  const params = [];

  if (filter.provider) { query += " AND provider = ?"; params.push(filter.provider); }
  if (filter.model) { query += " AND model = ?"; params.push(filter.model); }
  if (filter.startDate) { query += " AND timestamp >= ?"; params.push(new Date(filter.startDate).getTime()); }
  if (filter.endDate) { query += " AND timestamp <= ?"; params.push(new Date(filter.endDate).getTime()); }

  query += " ORDER BY timestamp DESC";
  return prepareStatement(db, query).all(...params).map(row => {
    return {
      provider: row.provider,
      model: row.model,
      connectionId: row.connection_id,
      apiKey: row.api_key,
      endpoint: row.endpoint,
      timestamp: new Date(row.timestamp).toISOString(),
      status: row.status,
      cost: row.cost,
      tokens: JSON.parse(row.tokens_json || '{}')
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getServerUsage() {
  if (isCloud) return { cpuPercent: 0, memoryUsedMb: 0, memoryTotalMb: 0, memoryPercent: 0, processRssMb: 0 };
  const cpuCount = os.cpus()?.length || 1;
  const loadAvg1m = os.loadavg?.()[0] || 0;
  const totalMem = os.totalmem?.() || 0;
  const freeMem = os.freemem?.() || 0;
  const usedMem = Math.max(0, totalMem - freeMem);
  const processRss = process.memoryUsage?.().rss || 0;
  const toMb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  return {
    cpuPercent: Math.round(Math.min(100, Math.max(0, (loadAvg1m / cpuCount) * 100)) * 10) / 10,
    memoryUsedMb: toMb(usedMem),
    memoryTotalMb: toMb(totalMem),
    memoryPercent: Math.round((totalMem > 0 ? (usedMem / totalMem) * 100 : 0) * 10) / 10,
    processRssMb: toMb(processRss),
  };
}

export async function appendRequestLog({ model, provider, connectionId, tokens, status }) {
  if (isCloud || !LOG_FILE) return;
  try {
    const timestamp = formatLogDate();
    const p = provider?.toUpperCase() || "-";
    const m = model || "-";
    let account = connectionId ? connectionId.slice(0, 8) : "-";
    try {
      const connections = await getProviderConnections();
      const conn = connections.find(c => c.id === connectionId);
      if (conn) account = conn.name || conn.email || account;
    } catch { }
    const sent = tokens?.prompt_tokens !== undefined ? tokens.prompt_tokens : "-";
    const rec = tokens?.completion_tokens !== undefined ? tokens.completion_tokens : "-";
    const line = `${timestamp} | ${m} | ${p} | ${account} | ${sent} | ${rec} | ${status}\n`;
    fs.appendFileSync(LOG_FILE, line);
    const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n");
    if (lines.length > 5000) fs.writeFileSync(LOG_FILE, lines.slice(-5000).join("\n") + "\n");
  } catch (err) { console.error("Failed to append log:", err.message); }
}

export async function getRecentLogs(options = {}) {
  const limit = options.limit || 200;
  const page = options.page || 1;
  const search = options.search ? options.search.toLowerCase() : "";

  if (isCloud || !fs || !LOG_FILE || !fs.existsSync(LOG_FILE)) return { logs: [], total: 0 };
  try {
    let lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(l => l);
    
    // Reverse so newest is first
    lines.reverse();
    
    if (search) {
      lines = lines.filter(line => line.toLowerCase().includes(search));
    }
    
    const total = lines.length;
    const startIndex = (page - 1) * limit;
    const paginatedLogs = lines.slice(startIndex, startIndex + limit);
    
    return { logs: paginatedLogs, total };
  } catch { return { logs: [], total: 0 }; }
}

export async function clearAllLogs() {
  if (isCloud || !fs || !LOG_FILE) return false;
  try {
    fs.writeFileSync(LOG_FILE, "");
    return true;
  } catch (err) {
    console.error("Failed to clear logs:", err.message);
    return false;
  }
}

// -----------------------------------------------------------------------------
// METRICS AGGREGATION
// -----------------------------------------------------------------------------
export async function getUsageStats() {
  const db = await getUsageDb();
  const { getProviderConnections, getApiKeys, getPricing, getProviderNodes } = await import("@/lib/localDb.js");

  try {
    await getPricing();
  } catch (error) {
    console.warn("Could not pre-fetch pricing for usage stats:", error.message);
  }

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const node of nodes) {
      if (node.id && node.name) providerNodeNameMap[node.id] = node.name;
    }
  } catch {}

  const stats = {
    totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [], pending: pendingRequests, activeRequests: [], recentRequests: [],
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
    serverUsage: getServerUsage(),
  };

  if (isCloud) return stats;

  const connectionMap = {};
  try { (await getProviderConnections()).forEach(c => connectionMap[c.id] = c.name || c.email || c.id); } catch { }
  
  const apiKeyMap = {};
  try { (await getApiKeys()).forEach(k => apiKeyMap[k.key] = { name: k.name }); } catch { }

  // Populate activeRequests from in-memory pending map
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`,
          count
        });
      }
    }
  }

  // Fetch recent 20 requests
  stats.recentRequests = db.prepare(`SELECT * FROM usage ORDER BY timestamp DESC LIMIT 20`).all().map(e => ({
    timestamp: new Date(e.timestamp).toISOString(),
    model: e.model, provider: e.provider || "",
    promptTokens: e.prompt_tokens, completionTokens: e.completion_tokens, status: e.status || "ok"
  }));

  // Totals
  const totalRow = db.prepare(`SELECT COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage`).get();
  stats.totalRequests = totalRow?.calls || 0;
  stats.totalPromptTokens = totalRow?.p || 0;
  stats.totalCompletionTokens = totalRow?.c || 0;
  stats.totalCost = totalRow?.cost || 0;

  // By Provider
  db.prepare(`SELECT provider, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage GROUP BY provider`).all().forEach(row => {
    if (row.provider) stats.byProvider[row.provider] = { requests: row.calls, promptTokens: row.p, completionTokens: row.c, cost: row.cost };
  });

  // By Model
  db.prepare(`SELECT model, provider, MAX(timestamp) as ts, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage GROUP BY model, provider`).all().forEach(row => {
    const key = row.provider ? `${row.model} (${row.provider})` : row.model;
    const providerDisplayName = providerNodeNameMap[row.provider] || row.provider;
    stats.byModel[key] = { requests: row.calls, promptTokens: row.p, completionTokens: row.c, cost: row.cost, rawModel: row.model, provider: providerDisplayName, lastUsed: new Date(row.ts).toISOString() };
  });

  // By Account
  db.prepare(`SELECT connection_id, model, provider, MAX(timestamp) as ts, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage WHERE connection_id IS NOT NULL GROUP BY connection_id, model, provider`).all().forEach(row => {
    const accountName = connectionMap[row.connection_id] || `Account ${row.connection_id.slice(0, 8)}...`;
    const key = `${row.model} (${row.provider} - ${accountName})`;
    const providerDisplayName = providerNodeNameMap[row.provider] || row.provider;
    stats.byAccount[key] = { requests: row.calls, promptTokens: row.p, completionTokens: row.c, cost: row.cost, rawModel: row.model, provider: providerDisplayName, connectionId: row.connection_id, accountName, lastUsed: new Date(row.ts).toISOString() };
  });

  // By API Key
  db.prepare(`SELECT api_key, model, provider, MAX(timestamp) as ts, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage GROUP BY api_key, model, provider`).all().forEach(row => {
    const providerDisplayName = providerNodeNameMap[row.provider] || row.provider;
    if (row.api_key) {
      const keyName = apiKeyMap[row.api_key]?.name || row.api_key.slice(0, 8) + "...";
      const key = `${row.api_key}|${row.model}|${row.provider || 'unknown'}`;
      stats.byApiKey[key] = { requests: row.calls, promptTokens: row.p, completionTokens: row.c, cost: row.cost, rawModel: row.model, provider: providerDisplayName, apiKey: row.api_key, keyName, apiKeyKey: row.api_key, lastUsed: new Date(row.ts).toISOString() };
    } else {
      const key = "local-no-key";
      if (!stats.byApiKey[key]) stats.byApiKey[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, provider: providerDisplayName, keyName: "Local (No API Key)", apiKeyKey: key, lastUsed: new Date(0).toISOString() };
      stats.byApiKey[key].requests += row.calls;
      stats.byApiKey[key].promptTokens += row.p;
      stats.byApiKey[key].completionTokens += row.c;
      stats.byApiKey[key].cost += row.cost;
      const tsStr = new Date(row.ts).toISOString();
      if (tsStr > stats.byApiKey[key].lastUsed) stats.byApiKey[key].lastUsed = tsStr;
    }
  });

  // By Endpoint
  db.prepare(`SELECT endpoint, model, provider, MAX(timestamp) as ts, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage GROUP BY endpoint, model, provider`).all().forEach(row => {
    const ep = row.endpoint || "Unknown";
    const key = `${ep}|${row.model}|${row.provider || 'unknown'}`;
    const providerDisplayName = providerNodeNameMap[row.provider] || row.provider;
    stats.byEndpoint[key] = { requests: row.calls, promptTokens: row.p, completionTokens: row.c, cost: row.cost, endpoint: ep, rawModel: row.model, provider: providerDisplayName, lastUsed: new Date(row.ts).toISOString() };
  });

  // Last 10 Minutes
  const now = new Date();
  const currentMinuteStart = Math.floor(now.getTime() / 60000) * 60000;
  const tenMinutesAgo = currentMinuteStart - 9 * 60000;
  
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart - (9 - i) * 60000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }

  db.prepare(`SELECT (timestamp / 60000) * 60000 as bucket, COUNT(*) as calls, SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(cost) as cost FROM usage WHERE timestamp >= ? GROUP BY bucket`).all(tenMinutesAgo).forEach(row => {
    if (bucketMap[row.bucket]) {
      bucketMap[row.bucket].requests = row.calls;
      bucketMap[row.bucket].promptTokens = row.p;
      bucketMap[row.bucket].completionTokens = row.c;
      bucketMap[row.bucket].cost = row.cost;
    }
  });

  return stats;
}

export async function getChartData(period = "7d") {
  const db = await getUsageDb();
  if (isCloud) return [];
  const now = Date.now();

  let bucketCount, bucketMs, labelFn;
  if (period === "24h") {
    bucketCount = 24; bucketMs = 3600000; labelFn = ts => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } else if (period === "30d") {
    bucketCount = 30; bucketMs = 86400000; labelFn = ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else if (period === "60d") {
    bucketCount = 60; bucketMs = 86400000; labelFn = ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else {
    bucketCount = 7; bucketMs = 86400000; labelFn = ts => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const startTime = now - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0, _ts: startTime + i * bucketMs }));

  db.prepare(`SELECT (timestamp - ?) / ? as bucketIdx, SUM(prompt_tokens + completion_tokens) as t, SUM(cost) as cost FROM usage WHERE timestamp >= ? AND timestamp <= ? GROUP BY bucketIdx`).all(startTime, bucketMs, startTime, now).forEach(row => {
    const idx = Math.min(Math.floor(row.bucketIdx), bucketCount - 1);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx].tokens += row.t;
      buckets[idx].cost += row.cost;
    }
  });

  return buckets.map(({ label, tokens, cost }) => ({ label, tokens, cost }));
}

// Re-export request details functions from requestDetailsDb
export { saveRequestDetail, getRequestDetails, getRequestDetailById, getModelSpeedStats, clearAllRequestDetails } from "./requestDetailsDb.js";
