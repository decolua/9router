#!/usr/bin/env node
import { Low } from "lowdb/node";
import { JSONFile } from "lowdb/node";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const isCloud = typeof caches !== 'undefined' || typeof caches === 'object';

// Get app name - fixed constant to avoid Windows path issues in standalone build
function getAppName() {
  return "9router";
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp"; // Fallback for Workers

  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
            const homeDir = os.homedir();
            const appName = getAppName();

            if (platform === "win32") {
                return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName), appName);
            } else {
                // macOS & Linux: ~/.{appName}
                return path.join(homeDir, `.${appName}`);
            }
        }
    }

    // Data file path - stored in user home directory
    const DATA_DIR = getUserDataDir();
    const DB_FILE = isCloud ? null : path.join(DATA_DIR, "db.json");

    // Ensure data directory exists
    if (!isCloud && !fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Default data structure
    const defaultData = {
        providerConnections: [],
        providerNodes: [],
        modelAliases: [],
        mitmAlias: {},
        combos: [],
        apiKeys: [],
        settings: {
            cloudEnabled: false,
            tunnelEnabled: false,
            tunnelUrl: "",
            stickyRoundRobinLimit: 3
            requireLogin: true
            observabilityEnabled: true
            observabilityMaxRecords: 1000
            observabilityBatchSize: 20
            observabilityFlushIntervalMs: 5000
            observabilityMaxJsonSize: 1024
            outboundProxyEnabled: false
            outboundProxyUrl: ""
            outboundNoProxy: ""
        },
        pricing: {} // NEW: pricing configuration
    };

    function cloneDefaultData() {
        return {
            providerConnections: [],
            providerNodes: [],
            modelAliases: [],
            mitmAlias: {},
            combos: [],
            apiKeys: [],
            settings: {
                cloudEnabled: false,
                tunnelEnabled: false,
                tunnelUrl: "",
                stickyRoundRobinLimit: 3,
                requireLogin: true,
                observabilityEnabled: true,
                observabilityMaxRecords: 1000,
                observabilityBatchSize: 20,
                observabilityFlushIntervalMs: 5000,
                observabilityMaxJsonSize: 1024,
                outboundProxyEnabled: false,
                outboundProxyUrl: "",
                outboundNoProxy: "",
            },
            pricing: {},
        };
    }

    function ensureDbShape(data) {
        const defaults = cloneDefaultData();
        const next = data && typeof data === "object" ? data : { ...next };
        let changed = false;

        for (const [key, defaultValue] of Object.entries(defaults)) {
            if (next[key] === undefined || next[key] === null) {
                next[key] = defaultValue;
                changed = true;
            }

            if (
                key === "settings" &&
                (typeof next.settings !== "object" || Array.isArray(next.settings))
            ) {
                next.settings = { ...defaultValue };
                changed = true;
                continue;
            }

            if (
                key === "settings" &&
                typeof next.settings === "object" &&
                !Array.isArray(next.settings)
            ) {
                for (const [settingKey, settingDefault] of Object.entries(defaultValue)) {
                    if (next.settings[settingKey] === undefined) {
                        // Backward-compat: if users previously saved a proxy URL,
                        // default to enabled so behavior doesn't silently change.
                        if (
                            settingKey === "outboundProxyEnabled" &&
                            typeof next.settings.outboundProxyUrl === "string" &&
                            next.settings.outboundProxyUrl.trim()
                        ) {
                            next.settings.outboundProxyEnabled = true;
                        } else {
                            next.settings[settingKey] = settingDefault;
                        }
                        changed = true;
                    }
                }
            }

            // Migrate existing API keys to have isActive
            if (key === "apiKeys" && Array.isArray(next.apiKeys)) {
                for (const apiKey of next.apiKeys) {
                    if (apiKey.isActive === undefined || apiKey.isActive === null) {
                        apiKey.isActive = true;
                        changed = true;
                    }
                }
            }
        }

        return { data: next, changed };
    }

    /**
     * Get database instance (singleton)
     */
    export async function getDb() {
        if (isCloud) {
            // Return in-memory DB for Workers
            if (!dbInstance) {
                const data = cloneDefaultData();
                dbInstance = new Low({ read: async () => {}, write: async () => {} }, data);
            dbInstance.data = data;
        }
        return dbInstance;
    }

    if (!dbInstance) {
        const adapter = new JSONFile(DB_FILE);
        dbInstance = new Low(adapter, cloneDefaultData());
    }

    // Always read latest disk state to avoid stale singleton data across route workers.
    try {
        await dbInstance.read();
    } catch (error) {
        if (error instanceof SyntaxError) {
            console.warn('[DB] Corrupt JSON detected, resetting to defaults...');
            dbInstance.data = cloneDefaultData();
            await dbInstance.write();
        } else {
            throw error;
        }
    }

    // Initialize/migrate missing keys for older DB schema versions.
    if (!dbInstance.data) {
        dbInstance.data = cloneDefaultData();
        await dbInstance.write();
    } else {
        const { data, changed } = ensureDbShape(dbInstance.data);
        dbInstance.data = data;
        if (changed) {
            await dbInstance.write();
        }
    }

    return dbInstance;
}

