import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROVIDERS, PROVIDER_MODELS } from "../providers/index.js";
import { normalizeModel } from "../providers/models/schema.js";

// In-memory store for custom adapters
const customAdaptersMap = new Map();
let watcherInitialized = false;

// Default custom providers directory relative to project root or environment variable
export function getCustomProvidersDir() {
  if (process.env.CUSTOM_PROVIDERS_DIR) {
    return path.resolve(process.env.CUSTOM_PROVIDERS_DIR);
  }
  return path.resolve(process.cwd(), "custom-providers");
}

/**
 * Normalizes an adapter definition object.
 */
export function normalizeAdapterDefinition(raw, source = "runtime", filePath = null) {
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.id || raw.prefix || `custom-adapter-${Date.now()}`).trim();
  const name = String(raw.name || id).trim();
  const prefix = String(raw.prefix || id).trim();
  const baseUrl = String(raw.baseUrl || "").trim();

  const models = Array.isArray(raw.models)
    ? raw.models.map((m) => (typeof m === "string" ? { id: m, name: m } : normalizeModel(m)))
    : [{ id: "default", name: `${name} Default Model` }];

  return {
    id,
    name,
    prefix,
    baseUrl,
    icon: raw.icon || "extension",
    color: raw.color || "#10a37f",
    description: raw.description || "",
    category: raw.category || "custom",
    authType: raw.authType || "apikey",
    headers: raw.headers || {},
    models,
    passthroughModels: raw.passthroughModels !== false,
    format: raw.format || "custom",
    requestMapping: raw.requestMapping || null,
    responseMapping: raw.responseMapping || null,
    streamMapping: raw.streamMapping || null,
    transformRequest: raw.transformRequest || null,
    transformResponse: raw.transformResponse || null,
    transformStreamChunk: raw.transformStreamChunk || null,
    serviceKinds: raw.serviceKinds || ["llm"],
    source, // "file" | "db" | "runtime"
    filePath,
    isActive: raw.isActive !== false,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Registers or updates a custom adapter in memory and into the Open-SSE provider tables.
 */
export function registerCustomAdapter(rawAdapter, source = "runtime", filePath = null) {
  const adapter = normalizeAdapterDefinition(rawAdapter, source, filePath);
  if (!adapter || !adapter.id) return null;

  customAdaptersMap.set(adapter.id, adapter);
  if (adapter.prefix && adapter.prefix !== adapter.id) {
    customAdaptersMap.set(adapter.prefix, adapter);
  }

  // Inject into runtime PROVIDERS
  PROVIDERS[adapter.id] = {
    baseUrl: adapter.baseUrl,
    format: adapter.format || "custom",
    headers: adapter.headers || {},
    auth: {
      combined: true,
      header: adapter.authType === "bearer" ? "Authorization" : "x-api-key",
      scheme: adapter.authType === "bearer" ? "bearer" : "raw",
    },
    passthroughModels: adapter.passthroughModels,
    isCustomAdapter: true,
    customAdapter: adapter,
  };

  // Inject into runtime PROVIDER_MODELS
  PROVIDER_MODELS[adapter.prefix || adapter.id] = adapter.models.map(normalizeModel);

  return adapter;
}

/**
 * Unregisters a custom adapter.
 */
export function unregisterCustomAdapter(id) {
  const adapter = customAdaptersMap.get(id);
  if (!adapter) return false;

  customAdaptersMap.delete(adapter.id);
  if (adapter.prefix) customAdaptersMap.delete(adapter.prefix);

  delete PROVIDERS[adapter.id];
  delete PROVIDER_MODELS[adapter.prefix || adapter.id];

  return true;
}

/**
 * Gets a custom adapter by ID or prefix.
 */
export function getCustomAdapter(idOrPrefix) {
  if (!idOrPrefix) return null;
  return customAdaptersMap.get(idOrPrefix) || null;
}

/**
 * Gets all registered custom adapters as an array.
 */
export function getAllCustomAdapters() {
  const unique = new Map();
  for (const adapter of customAdaptersMap.values()) {
    unique.set(adapter.id, adapter);
  }
  return Array.from(unique.values());
}

/**
 * Loads a single adapter file (.json or .js / .mjs).
 */
export async function loadAdapterFromFile(fullPath) {
  try {
    const ext = path.extname(fullPath).toLowerCase();
    let content = null;

    if (ext === ".json") {
      const raw = fs.readFileSync(fullPath, "utf-8");
      content = JSON.parse(raw);
    } else if (ext === ".js" || ext === ".mjs") {
      // Dynamic import with cache-busting timestamp for hot-reloading
      const fileUrl = `${pathToFileURL(fullPath).href}?t=${Date.now()}`;
      const mod = await import(fileUrl);
      content = mod.default || mod;
    }

    if (content) {
      return registerCustomAdapter(content, "file", fullPath);
    }
  } catch (err) {
    console.error(`[CustomAdapter] Failed to load adapter from ${fullPath}:`, err.message);
  }
  return null;
}

/**
 * Loads all custom adapters from the specified directory.
 */
export async function loadCustomAdaptersFromDir(dirPath = getCustomProvidersDir()) {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {
      return [];
    }
  }

  const loaded = [];
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith(".") || file.startsWith("_")) continue;
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && (file.endsWith(".json") || file.endsWith(".js") || file.endsWith(".mjs"))) {
        const adapter = await loadAdapterFromFile(fullPath);
        if (adapter) loaded.push(adapter);
      }
    }
  } catch (err) {
    console.error(`[CustomAdapter] Error scanning directory ${dirPath}:`, err.message);
  }
  return loaded;
}

/**
 * Initializes a file watcher on the custom providers directory for hot-reloading.
 */
export function initCustomAdaptersWatcher(dirPath = getCustomProvidersDir()) {
  if (watcherInitialized) return;
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch {
      return;
    }
  }

  try {
    let debounceTimer = null;
    fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
      if (!filename || (!filename.endsWith(".json") && !filename.endsWith(".js") && !filename.endsWith(".mjs"))) {
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const fullPath = path.join(dirPath, filename);
        if (fs.existsSync(fullPath)) {
          console.log(`[CustomAdapter][HotReload] Reloading adapter: ${filename}`);
          await loadAdapterFromFile(fullPath);
        } else {
          // File deleted -> unregister
          for (const adapter of getAllCustomAdapters()) {
            if (adapter.filePath === fullPath) {
              console.log(`[CustomAdapter][HotReload] Unregistering adapter: ${adapter.id}`);
              unregisterCustomAdapter(adapter.id);
            }
          }
        }
      }, 300);
    });
    watcherInitialized = true;
    console.log(`[CustomAdapter] Watcher initialized on ${dirPath}`);
  } catch (err) {
    console.warn(`[CustomAdapter] Could not initialize file watcher: ${err.message}`);
  }
}
