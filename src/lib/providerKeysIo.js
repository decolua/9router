/**
 * Serialize / parse provider API-key (and cookie) connections for export/import.
 *
 * TXT (bulk) format — one key per line (matches AddApiKeyModal bulk add):
 *   name|apiKey
 *   name|apiKey|accountId   (cloudflare-ai)
 *   apiKey                   (auto-named on import)
 *
 * JSON format:
 *   {
 *     "version": 1,
 *     "provider": "openrouter",
 *     "exportedAt": "…",
 *     "keys": [
 *       { "name": "…", "apiKey": "…", "priority": 1, "isActive": true, … }
 *     ]
 *   }
 * Also accepts a bare array of key objects, or { accounts: [...] } / { keys: [...] }.
 */

export const EXPORT_VERSION = 1;
export const EXPORTABLE_AUTH_TYPES = new Set(["apikey", "cookie"]);

/** Fields from providerSpecificData worth round-tripping across machines. */
const PSD_EXPORT_KEYS = [
  "accountId",
  "region",
  "baseUrl",
  "azureEndpoint",
  "apiVersion",
  "deployment",
  "organization",
];

/**
 * @param {object} conn - full connection row (may include secrets)
 * @returns {boolean}
 */
export function isExportableConnection(conn) {
  if (!conn) return false;
  const authType = conn.authType || "apikey";
  if (!EXPORTABLE_AUTH_TYPES.has(authType)) return false;
  // ollama-local may have empty apiKey
  if (conn.provider === "ollama-local") return true;
  return typeof conn.apiKey === "string" && conn.apiKey.length > 0;
}

/**
 * Pick a portable subset of providerSpecificData for export.
 * @param {object|null|undefined} psd
 * @returns {object|undefined}
 */
export function pickExportableProviderSpecificData(psd) {
  if (!psd || typeof psd !== "object") return undefined;
  const out = {};
  for (const key of PSD_EXPORT_KEYS) {
    if (psd[key] !== undefined && psd[key] !== null && psd[key] !== "") {
      out[key] = psd[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map a DB connection to a portable export record.
 * @param {object} conn
 * @returns {object}
 */
export function connectionToExportKey(conn) {
  const record = {
    name: conn.name || "",
    apiKey: conn.apiKey || "",
    authType: conn.authType === "cookie" ? "cookie" : "apikey",
    priority: conn.priority ?? 1,
    isActive: conn.isActive !== false,
  };
  if (conn.defaultModel) record.defaultModel = conn.defaultModel;
  if (conn.globalPriority != null) record.globalPriority = conn.globalPriority;
  const psd = pickExportableProviderSpecificData(conn.providerSpecificData);
  if (psd) record.providerSpecificData = psd;
  return record;
}

/**
 * Build JSON export payload for a provider.
 * @param {string} providerId
 * @param {object[]} connections - full connection rows
 * @returns {object}
 */
export function buildExportJson(providerId, connections) {
  const keys = (connections || [])
    .filter(isExportableConnection)
    .map(connectionToExportKey);
  return {
    version: EXPORT_VERSION,
    provider: providerId,
    exportedAt: new Date().toISOString(),
    count: keys.length,
    keys,
  };
}

/**
 * Build TXT export content (one key per line).
 * @param {string} providerId
 * @param {object[]} connections
 * @returns {string}
 */
export function buildExportTxt(providerId, connections) {
  const lines = [];
  for (const conn of (connections || []).filter(isExportableConnection)) {
    const name = (conn.name || "Key").replace(/\|/g, "_");
    const apiKey = conn.apiKey || "";
    const accountId = conn.providerSpecificData?.accountId;
    if (providerId === "cloudflare-ai" && accountId) {
      lines.push(`${name}|${apiKey}|${accountId}`);
    } else {
      lines.push(`${name}|${apiKey}`);
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/**
 * Normalize various JSON shapes into an array of key records.
 * @param {unknown} parsed
 * @returns {object[]|null}
 */
export function normalizeJsonKeys(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeKeyEntry).filter(Boolean);
  }
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.keys)) {
      return parsed.keys.map(normalizeKeyEntry).filter(Boolean);
    }
    if (Array.isArray(parsed.accounts)) {
      return parsed.accounts.map(normalizeKeyEntry).filter(Boolean);
    }
    // Single object with apiKey
    const one = normalizeKeyEntry(parsed);
    return one ? [one] : null;
  }
  return null;
}

/**
 * @param {unknown} entry
 * @returns {object|null}
 */
function normalizeKeyEntry(entry) {
  if (typeof entry === "string") {
    const apiKey = entry.trim();
    if (!apiKey) return null;
    return { name: "", apiKey, authType: "apikey", priority: 1, isActive: true };
  }
  if (!entry || typeof entry !== "object") return null;

  const apiKey = (
    entry.apiKey ||
    entry.key ||
    entry.token ||
    entry.cookie ||
    ""
  ).toString().trim();

  // Allow empty apiKey only when explicitly named ollama-style (handled by caller validation)
  const name = (entry.name || entry.displayName || "").toString().trim();
  const authType = entry.authType === "cookie" ? "cookie" : "apikey";

  const record = {
    name,
    apiKey,
    authType,
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 1,
    isActive: entry.isActive !== false,
  };
  if (entry.defaultModel) record.defaultModel = String(entry.defaultModel);
  if (entry.globalPriority != null && entry.globalPriority !== "") {
    record.globalPriority = Number(entry.globalPriority);
  }
  if (entry.providerSpecificData && typeof entry.providerSpecificData === "object") {
    record.providerSpecificData = pickExportableProviderSpecificData(entry.providerSpecificData)
      || entry.providerSpecificData;
  } else {
    // Flattened accountId / region on the entry itself
    const flat = {};
    for (const key of PSD_EXPORT_KEYS) {
      if (entry[key] !== undefined && entry[key] !== null && entry[key] !== "") {
        flat[key] = entry[key];
      }
    }
    if (Object.keys(flat).length > 0) record.providerSpecificData = flat;
  }
  return record;
}

/**
 * Parse TXT bulk content into key records.
 * @param {string} text
 * @param {{ provider?: string }} [opts]
 * @returns {object[]}
 */
export function parseTxtKeys(text, opts = {}) {
  const provider = opts.provider || "";
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // skip comments
    .filter((l) => !l.startsWith("#"));

  const keys = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|");
    let name = "";
    let apiKey = "";
    let providerSpecificData;

    if (provider === "cloudflare-ai" && parts.length >= 3) {
      name = parts[0].trim();
      apiKey = parts.slice(1, -1).join("|").trim();
      const accountId = parts[parts.length - 1].trim();
      if (accountId) providerSpecificData = { accountId };
    } else if (parts.length >= 2) {
      name = parts[0].trim();
      apiKey = parts.slice(1).join("|").trim();
    } else {
      apiKey = parts[0].trim();
      name = "";
    }

    if (!apiKey && provider !== "ollama-local") continue;

    keys.push({
      name,
      apiKey,
      authType: "apikey",
      priority: 1,
      isActive: true,
      ...(providerSpecificData ? { providerSpecificData } : {}),
    });
  }
  return keys;
}

/**
 * Parse import payload (string content or already-parsed object).
 * @param {string|object} content
 * @param {"json"|"txt"|"auto"} format
 * @param {{ provider?: string }} [opts]
 * @returns {{ keys: object[], format: "json"|"txt", providerHint?: string }}
 */
export function parseImportContent(content, format = "auto", opts = {}) {
  if (format === "txt" || (format === "auto" && typeof content === "string" && !looksLikeJson(content))) {
    const text = typeof content === "string" ? content : String(content ?? "");
    return { keys: parseTxtKeys(text, opts), format: "txt" };
  }

  let parsed = content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) return { keys: [], format: "json" };
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      if (format === "json") {
        throw new Error(`Invalid JSON: ${err.message}`);
      }
      // auto-fallback to txt
      return { keys: parseTxtKeys(content, opts), format: "txt" };
    }
  }

  const keys = normalizeJsonKeys(parsed);
  if (!keys) {
    throw new Error("No keys found in JSON input");
  }

  const providerHint =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.provider === "string"
      ? parsed.provider
      : undefined;

  return { keys, format: "json", providerHint };
}

function looksLikeJson(text) {
  const t = String(text || "").trim();
  return t.startsWith("{") || t.startsWith("[");
}

/**
 * Assign display names for entries missing a name.
 * @param {object[]} keys
 * @param {string} [fallbackBase="Key"]
 * @returns {object[]}
 */
export function ensureKeyNames(keys, fallbackBase = "Key") {
  return keys.map((k, i) => ({
    ...k,
    name: (k.name && String(k.name).trim()) || `${fallbackBase} ${i + 1}`,
  }));
}
