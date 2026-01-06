import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

// Get app name from root package.json config
function getAppName() {
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
  const platform = process.platform;
  const homeDir = os.homedir();
  const appName = getAppName();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
  } else {
    // macOS & Linux: ~/.{appName}
    return path.join(homeDir, `.${appName}`);
  }
}

// Data file path - stored in user home directory
const DATA_DIR = getUserDataDir();
const DB_FILE = path.join(DATA_DIR, "usage.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default data structure
const defaultData = {
  history: []
};

// Singleton instance
let dbInstance = null;

/**
 * Get usage database instance (singleton)
 */
export async function getUsageDb() {
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
 * @param {object} entry - Usage entry { provider, model, tokens: { prompt_tokens, completion_tokens, ... }, connectionId? }
 */
export async function saveRequestUsage(entry) {
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

    db.data.history.push(entry);

    // Optional: Limit history size if needed in future
    // if (db.data.history.length > 10000) db.data.history.shift();

    await db.write();
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
 * Get aggregated usage stats
 */
export async function getUsageStats() {
  const db = await getUsageDb();
  const history = db.data.history || [];

  // Import localDb to get provider connection names
  const { getProviderConnections } = await import("@/lib/localDb.js");

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

  const stats = {
    totalRequests: history.length,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    byProvider: {},
    byModel: {},
    byAccount: {},
    last10Minutes: []
  };

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
      completionTokens: 0
    };
    stats.last10Minutes.push(bucketMap[bucketKey]);
  }

  for (const entry of history) {
    const promptTokens = entry.tokens?.prompt_tokens || 0;
    const completionTokens = entry.tokens?.completion_tokens || 0;
    const entryTime = new Date(entry.timestamp);

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;

    // Last 10 minutes aggregation - floor entry time to its minute
    if (entryTime >= tenMinutesAgo && entryTime <= now) {
      const entryMinuteStart = Math.floor(entryTime.getTime() / 60000) * 60000;
      if (bucketMap[entryMinuteStart]) {
        bucketMap[entryMinuteStart].requests++;
        bucketMap[entryMinuteStart].promptTokens += promptTokens;
        bucketMap[entryMinuteStart].completionTokens += completionTokens;
      }
    }

    // By Provider
    if (!stats.byProvider[entry.provider]) {
      stats.byProvider[entry.provider] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0
      };
    }
    stats.byProvider[entry.provider].requests++;
    stats.byProvider[entry.provider].promptTokens += promptTokens;
    stats.byProvider[entry.provider].completionTokens += completionTokens;

    // By Model
    // Format: "modelName (provider)" if provider is known
    const modelKey = entry.provider ? `${entry.model} (${entry.provider})` : entry.model;

    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        rawModel: entry.model,
        provider: entry.provider
      };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;

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
          rawModel: entry.model,
          provider: entry.provider,
          connectionId: entry.connectionId,
          accountName: accountName
        };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
    }
  }

  return stats;
}
