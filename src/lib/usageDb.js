import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { EventEmitter } from "events";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

// Get app name from root package.json config
function getAppName() {
  if (isCloud) return "9router"; // Skip file system access in Workers

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Look for root package.json (monorepo root)
  const rootPkgPath = path.resolve(__dirname, "../../../package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    return pkg.config?.appName || "9router";
  } catch {
    return "9router";
  }
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp"; // Fallback for Workers

  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  try {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appName = getAppName();

    if (platform === "win32") {
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
    } else {
      // macOS & Linux: ~/.{appName}
      return path.join(homeDir, `.${appName}`);
    }
  } catch (error) {
    console.error("[usageDb] Failed to get user data directory:", error.message);
    // Fallback to cwd if homedir fails
    return path.join(process.cwd(), ".9router");
  }
}

// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "usage.json");
const LOG_FILE = isCloud ? null : path.join(DATA_DIR, "log.txt");

// Ensure data directory exists
if (!isCloud && fs && typeof fs.existsSync === "function") {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`[usageDb] Created data directory: ${DATA_DIR}`);
    }
  } catch (error) {
    console.error("[usageDb] Failed to create data directory:", error.message);
  }
}

// Default data structure
const defaultData = {
  history: []
};

// Singleton instance
let dbInstance = null;

// Use global to share pending state across Next.js route modules
if (!global._pendingRequests) {
  global._pendingRequests = { byModel: {}, byAccount: {} };
}
const pendingRequests = global._pendingRequests;

// Track last error provider for UI edge coloring (auto-clears after 10s)
if (!global._lastErrorProvider) {
  global._lastErrorProvider = { provider: "", ts: 0 };
}
const lastErrorProvider = global._lastErrorProvider;

// Use global to share singleton across Next.js route modules
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
export const statsEmitter = global._statsEmitter;

/**
 * Track a pending request
 * @param {string} model
 * @param {string} provider
 * @param {string} connectionId
 * @param {boolean} started - true if started, false if finished
 * @param {boolean} [error] - true if ended with error
 */
export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;

  // Track by model
  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));

  // Track by account
  if (connectionId) {
    const accountKey = connectionId;
    if (!pendingRequests.byAccount[accountKey]) pendingRequests.byAccount[accountKey] = {};
    if (!pendingRequests.byAccount[accountKey][modelKey]) pendingRequests.byAccount[accountKey][modelKey] = 0;
    pendingRequests.byAccount[accountKey][modelKey] = Math.max(0, pendingRequests.byAccount[accountKey][modelKey] + (started ? 1 : -1));
  }

  // Track error provider (auto-clears after 10s)
  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  console.log(`[PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model} | emitter listeners=${statsEmitter.listenerCount("pending")}`);
  statsEmitter.emit("pending");
}

/**
 * Lightweight: get only activeRequests + recentRequests without full stats recalc
 */
export async function getActiveRequests() {
  const activeRequests = [];

  // Build active requests from pending state
  let connectionMap = {};
  try {
    const { getProviderConnections } = await import("@/lib/localDb.js");
    const allConnections = await getProviderConnections();
    for (const conn of allConnections) {
      connectionMap[conn.id] = conn.name || conn.email || conn.id;
    }
  } catch {}

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

  // Get recent requests from history (re-read to get latest)
  const db = await getUsageDb();
  await db.read();
  const history = db.data.history || [];
  const seen = new Set();
  const recentRequests = [...history]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      const promptTokens = t.prompt_tokens || t.input_tokens || 0;
      const completionTokens = t.completion_tokens || t.output_tokens || 0;
      return { timestamp: e.timestamp, model: e.model, provider: e.provider || "", promptTokens, completionTokens, status: e.status || "ok" };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  // Error provider (auto-clear after 10s)
  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";

  return { activeRequests, recentRequests, errorProvider };
}

/**
 * Get usage database instance (singleton)
 */
export async function getUsageDb() {
  if (isCloud) {
    // Return in-memory DB for Workers
    if (!dbInstance) {
      dbInstance = new Low({ read: async () => {}, write: async () => {} }, defaultData);
      dbInstance.data = defaultData;
    }
    return dbInstance;
  }

  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    dbInstance = new Low(adapter, defaultData);

    // Try to read DB with error recovery for corrupt JSON
    try {
      await dbInstance.read();
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('[DB] Corrupt Usage JSON detected, resetting to defaults...');
        dbInstance.data = defaultData;
        await dbInstance.write();
      } else {
        throw error;
      }
    }

    // Initialize with default data if empty
    if (!dbInstance.data) {
      dbInstance.data = defaultData;
      await dbInstance.write();
    }
  }
  return dbInstance;
}

/**
 * Save request usage
 * @param {object} entry - Usage entry { provider, model, tokens: { prompt_tokens, completion_tokens, ... }, connectionId?, apiKey? }
 */
export async function saveRequestUsage(entry) {
  if (isCloud) return; // Skip saving in Workers

  try {
    const db = await getUsageDb();

    // Add timestamp if not present
    if (!entry.timestamp) {
      entry.timestamp = new Date().toISOString();
    }

    // Ensure history array exists
    if (!Array.isArray(db.data.history)) {
      db.data.history = [];
    }

    const entryCost = await calculateCost(entry.provider, entry.model, entry.tokens);
    entry.cost = entryCost;
    db.data.history.push(entry);

    // Optional: Limit history size if needed in future
    // if (db.data.history.length > 10000) db.data.history.shift();

    await db.write();
    statsEmitter.emit("update");
  } catch (error) {
    console.error("Failed to save usage stats:", error);
  }
}

/**
 * Get usage history
 * @param {object} filter - Filter criteria
 */
export async function getUsageHistory(filter = {}) {
  const db = await getUsageDb();
  let history = db.data.history || [];

  // Apply filters
  if (filter.provider) {
    history = history.filter(h => h.provider === filter.provider);
  }

  if (filter.model) {
    history = history.filter(h => h.model === filter.model);
  }

  if (filter.startDate) {
    const start = new Date(filter.startDate).getTime();
    history = history.filter(h => new Date(h.timestamp).getTime() >= start);
  }

  if (filter.endDate) {
    const end = new Date(filter.endDate).getTime();
    history = history.filter(h => new Date(h.timestamp).getTime() <= end);
  }

  return history;
}

/**
 * Format date as dd-mm-yyyy h:m:s
 */
function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${d}-${m}-${y} ${h}:${min}:${s}`;
}

/**
 * Append to log.txt
 * Format: datetime(dd-mm-yyyy h:m:s) | model | provider | account | tokens sent | tokens received | status
 */
export async function appendRequestLog({ model, provider, connectionId, tokens, status }) {
  if (isCloud) return; // Skip logging in Workers

  try {
    const timestamp = formatLogDate();
    const p = provider?.toUpperCase() || "-";
    const m = model || "-";

    // Resolve account name
    let account = connectionId ? connectionId.slice(0, 8) : "-";
    try {
      const { getProviderConnections } = await import("@/lib/localDb.js");
      const connections = await getProviderConnections();
      const conn = connections.find(c => c.id === connectionId);
      if (conn) {
        account = conn.name || conn.email || account;
      }
    } catch {}

    const sent = tokens?.prompt_tokens !== undefined ? tokens.prompt_tokens : "-";
    const received = tokens?.completion_tokens !== undefined ? tokens.completion_tokens : "-";

    const line = `${timestamp} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${status}\n`;

    fs.appendFileSync(LOG_FILE, line);

    // Trim to keep only last 200 lines
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length > 200) {
      fs.writeFileSync(LOG_FILE, lines.slice(-200).join("\n") + "\n");
    }
  } catch (error) {
    console.error("Failed to append to log.txt:", error.message);
  }
}

/**
 * Get last N lines of log.txt
 */
export async function getRecentLogs(limit = 200) {
  if (isCloud) return []; // Skip in Workers
  
  // Runtime check: ensure fs module is available
  if (!fs || typeof fs.existsSync !== "function") {
    console.error("[usageDb] fs module not available in this environment");
    return [];
  }
  
  if (!LOG_FILE) {
    console.error("[usageDb] LOG_FILE path not defined");
    return [];
  }
  
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`[usageDb] Log file does not exist: ${LOG_FILE}`);
    return [];
  }
  
  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-limit).reverse();
  } catch (error) {
    console.error("[usageDb] Failed to read log.txt:", error.message);
    console.error("[usageDb] LOG_FILE path:", LOG_FILE);
    return [];
  }
}

/**
 * Calculate cost for a usage entry
 * @param {string} provider - Provider ID
 * @param {string} model - Model ID
 * @param {object} tokens - Token counts
 * @returns {number} Cost in dollars
 */
async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;

  try {
    const { getPricingForModel } = await import("@/lib/localDb.js");
    const pricing = await getPricingForModel(provider, model);

    if (!pricing) return 0;

    let cost = 0;

    // Input tokens (non-cached)
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

    cost += (nonCachedInput * (pricing.input / 1000000));

    // Cached tokens
    if (cachedTokens > 0) {
      const cachedRate = pricing.cached || pricing.input; // Fallback to input rate
      cost += (cachedTokens * (cachedRate / 1000000));
    }

    // Output tokens
    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += (outputTokens * (pricing.output / 1000000));

    // Reasoning tokens
    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const reasoningRate = pricing.reasoning || pricing.output; // Fallback to output rate
      cost += (reasoningTokens * (reasoningRate / 1000000));
    }

    // Cache creation tokens
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const cacheCreationRate = pricing.cache_creation || pricing.input; // Fallback to input rate
      cost += (cacheCreationTokens * (cacheCreationRate / 1000000));
    }

    return cost;
  } catch (error) {
    console.error("Error calculating cost:", error);
    return 0;
  }
}

/**
 * Get aggregated usage stats
 */
export async function getUsageStats() {
  const db = await getUsageDb();
  const history = db.data.history || [];

  // Import localDb to get provider connection names and API keys
  const { getProviderConnections, getApiKeys, getProviderNodes } = await import("@/lib/localDb.js");

  // Fetch all provider connections to get account names
  let allConnections = [];
  try {
    allConnections = await getProviderConnections();
  } catch (error) {
    // If localDb is not available (e.g., in some environments), continue without account names
    console.warn("Could not fetch provider connections for usage stats:", error.message);
  }

  // Create a map from connectionId to account name
  const connectionMap = {};
  for (const conn of allConnections) {
    connectionMap[conn.id] = conn.name || conn.email || conn.id;
  }

  // Build map from compatible provider ID → friendly name (from providerNodes)
  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const node of nodes) {
      if (node.id && node.name) providerNodeNameMap[node.id] = node.name;
    }
  } catch {}

  // Fetch all API keys to get key names
  let allApiKeys = [];
  try {
    allApiKeys = await getApiKeys();
  } catch (error) {
    console.warn("Could not fetch API keys for usage stats:", error.message);
  }

  // Create a map from API key to key info
  const apiKeyMap = {};
  for (const key of allApiKeys) {
    apiKeyMap[key.key] = {
      name: key.name,
      id: key.id,
      createdAt: key.createdAt
    };
  }

  // 20 most recent requests from history (always in sync with SSE emit)
  const seen = new Set();
  const recentRequests = [...history]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      const promptTokens = t.prompt_tokens || t.input_tokens || 0;
      const completionTokens = t.completion_tokens || t.output_tokens || 0;
      return {
        timestamp: e.timestamp,
        model: e.model,
        provider: e.provider || "",
        promptTokens,
        completionTokens,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      // Deduplicate: same model+provider+tokens within same minute
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: history.length,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    byApiKey: {},
    byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Build active requests list from pending counts
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        // modelKey is "model (provider)"
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        const modelName = match ? match[1] : modelKey;
        const providerName = match ? match[2] : "unknown";

        stats.activeRequests.push({
          model: modelName,
          provider: providerName,
          account: accountName,
          count
        });
      }
    }
  }

  // Initialize 10-minute buckets using stable minute boundaries
  const now = new Date();
  // Floor to the start of the current minute
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);

  // Create buckets keyed by minute timestamp for stable lookups
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const bucketTime = new Date(currentMinuteStart.getTime() - (9 - i) * 60 * 1000);
    const bucketKey = bucketTime.getTime();
    bucketMap[bucketKey] = {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0
    };
    stats.last10Minutes.push(bucketMap[bucketKey]);
  }

  for (const entry of history) {
    const promptTokens = entry.tokens?.prompt_tokens || 0;
    const completionTokens = entry.tokens?.completion_tokens || 0;
    const entryTime = new Date(entry.timestamp);

    // Calculate cost for this entry
    const entryCost = await calculateCost(entry.provider, entry.model, entry.tokens);

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCost += entryCost;

    // Last 10 minutes aggregation - floor entry time to its minute
    if (entryTime >= tenMinutesAgo && entryTime <= now) {
      const entryMinuteStart = Math.floor(entryTime.getTime() / 60000) * 60000;
      if (bucketMap[entryMinuteStart]) {
        bucketMap[entryMinuteStart].requests++;
        bucketMap[entryMinuteStart].promptTokens += promptTokens;
        bucketMap[entryMinuteStart].completionTokens += completionTokens;
        bucketMap[entryMinuteStart].cost += entryCost;
      }
    }

    // By Provider
    if (!stats.byProvider[entry.provider]) {
      stats.byProvider[entry.provider] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0
      };
    }
    stats.byProvider[entry.provider].requests++;
    stats.byProvider[entry.provider].promptTokens += promptTokens;
    stats.byProvider[entry.provider].completionTokens += completionTokens;
    stats.byProvider[entry.provider].cost += entryCost;

    // By Model
    // Format: "modelName (provider)" if provider is known
    const modelKey = entry.provider ? `${entry.model} (${entry.provider})` : entry.model;
    // Resolve friendly name for compatible providers
    const providerDisplayName = providerNodeNameMap[entry.provider] || entry.provider;

    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        rawModel: entry.model,
        provider: providerDisplayName,
        lastUsed: entry.timestamp
      };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;
    stats.byModel[modelKey].cost += entryCost;
    if (new Date(entry.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) {
      stats.byModel[modelKey].lastUsed = entry.timestamp;
    }

    // By Account (model + oauth account)
    // Use connectionId if available, otherwise fallback to provider name
    if (entry.connectionId) {
      const accountName = connectionMap[entry.connectionId] || `Account ${entry.connectionId.slice(0, 8)}...`;
      const accountKey = `${entry.model} (${entry.provider} - ${accountName})`;

      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          rawModel: entry.model,
          provider: providerDisplayName,
          connectionId: entry.connectionId,
          accountName: accountName,
          lastUsed: entry.timestamp
        };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
      stats.byAccount[accountKey].cost += entryCost;
      if (new Date(entry.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) {
        stats.byAccount[accountKey].lastUsed = entry.timestamp;
      }
    }

    // Handle requests with API key
    if (entry.apiKey && typeof entry.apiKey === "string") {
      const keyInfo = apiKeyMap[entry.apiKey];
      const keyName = keyInfo?.name || entry.apiKey.slice(0, 8) + "...";
      // Use full API key to avoid collisions (keys with same prefix)
      const apiKeyKey = entry.apiKey;
      // Group by API Key + Model + Provider combination to track different models used with the same key
      const apiKeyModelKey = `${apiKeyKey}|${entry.model}|${entry.provider || 'unknown'}`;

      if (!stats.byApiKey[apiKeyModelKey]) {
        stats.byApiKey[apiKeyModelKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          rawModel: entry.model,
          provider: providerDisplayName,
          apiKey: entry.apiKey,
          keyName: keyName,
          apiKeyKey: apiKeyKey,
          lastUsed: entry.timestamp
        };
      }
      const apiKeyEntry = stats.byApiKey[apiKeyModelKey];
      apiKeyEntry.requests++;
      apiKeyEntry.promptTokens += promptTokens;
      apiKeyEntry.completionTokens += completionTokens;
      apiKeyEntry.cost += entryCost;
      if (new Date(entry.timestamp) > new Date(apiKeyEntry.lastUsed)) {
        apiKeyEntry.lastUsed = entry.timestamp;
      }
    } else {
      const apiKeyKey = "local-no-key";
      const keyName = "Local (No API Key)";

      if (!stats.byApiKey[apiKeyKey]) {
        stats.byApiKey[apiKeyKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          rawModel: entry.model,
          provider: providerDisplayName,
          apiKey: null,
          keyName: keyName,
          apiKeyKey: apiKeyKey,
          lastUsed: entry.timestamp
        };
      }
      const apiKeyEntry = stats.byApiKey[apiKeyKey];
      apiKeyEntry.requests++;
      apiKeyEntry.promptTokens += promptTokens;
      apiKeyEntry.completionTokens += completionTokens;
      apiKeyEntry.cost += entryCost;
      if (new Date(entry.timestamp) > new Date(apiKeyEntry.lastUsed)) {
        apiKeyEntry.lastUsed = entry.timestamp;
      }
    }

    // By Endpoint (endpoint + model + provider combination)
    const endpoint = entry.endpoint || "Unknown";
    const endpointModelKey = `${endpoint}|${entry.model}|${entry.provider || 'unknown'}`;

    if (!stats.byEndpoint[endpointModelKey]) {
      stats.byEndpoint[endpointModelKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        endpoint: endpoint,
        rawModel: entry.model,
        provider: providerDisplayName,
        lastUsed: entry.timestamp
      };
    }
    const endpointEntry = stats.byEndpoint[endpointModelKey];
    endpointEntry.requests++;
    endpointEntry.promptTokens += promptTokens;
    endpointEntry.completionTokens += completionTokens;
    endpointEntry.cost += entryCost;
    if (new Date(entry.timestamp) > new Date(endpointEntry.lastUsed)) {
      endpointEntry.lastUsed = entry.timestamp;
    }
  }

  return stats;
}

/**
 * Get time-series chart data for a given period
 * @param {"24h"|"7d"|"30d"|"60d"} period
 * @returns {Promise<Array<{label: string, tokens: number, cost: number}>>}
 */
export async function getChartData(period = "7d") {
  const db = await getUsageDb();
  const history = db.data.history || [];
  const now = Date.now();

  let bucketCount, bucketMs, labelFn;
  if (period === "24h") {
    bucketCount = 24;
    bucketMs = 3600000; // 1 hour
    labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } else if (period === "7d") {
    bucketCount = 7;
    bucketMs = 86400000;
    labelFn = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else if (period === "30d") {
    bucketCount = 30;
    bucketMs = 86400000;
    labelFn = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else {
    bucketCount = 60;
    bucketMs = 86400000;
    labelFn = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const startTime = now - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const ts = startTime + i * bucketMs;
    return { label: labelFn(ts), tokens: 0, cost: 0, _ts: ts };
  });

  for (const entry of history) {
    const entryTime = new Date(entry.timestamp).getTime();
    if (entryTime < startTime || entryTime > now) continue;
    const idx = Math.min(Math.floor((entryTime - startTime) / bucketMs), bucketCount - 1);
    const promptTokens = entry.tokens?.prompt_tokens || 0;
    const completionTokens = entry.tokens?.completion_tokens || 0;
    buckets[idx].tokens += promptTokens + completionTokens;
    // Use pre-stored cost if available, else 0
    buckets[idx].cost += entry.cost || 0;
  }

  return buckets.map(({ label, tokens, cost }) => ({ label, tokens, cost }));
}

// Re-export request details functions from new SQLite-based module
export { saveRequestDetail, getRequestDetails, getRequestDetailById } from "./requestDetailsDb.js";
