/**
 * Custom quota sources for providers without a built-in usage endpoint.
 *
 * A source is user-authored settings (Dashboard -> Quota -> Custom quota):
 *   {
 *     enabled: true,
 *     plan: "Custom",
 *     itemsPath: "data.limits[*]",          // optional: one row per array item
 *     request: { url, method, headers: [{ name, value }], body },
 *     quotas: [{
 *       name, namePath, itemsPath,
 *       usedPath, totalPath, remainingPath, percentUsedPath, percentRemainingPath,
 *       unitPath, unit, totalValue,
 *       resetAtPath, resetAtUnit, unlimitedPath, creditBalancePath, currency
 *     }]
 *   }
 *
 * Paths are dot/bracket expressions over the response JSON: "usage.used",
 * "limits[0].percent", "data.items[*].quota". Values are read from the
 * connection (apiKey/accessToken/baseUrl) through {{placeholders}}.
 */

import { fetchPublic } from "@/shared/utils/ssrfGuard.js";

export const CUSTOM_QUOTA_SETTINGS_KEY = "customQuotaSources";
export const CUSTOM_QUOTA_RAW_LIMIT = 20000;

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Read a value from JSON by dot/bracket path. `[*]` expands arrays (or object
 * values); `[n]` picks an index. Multi-value paths return an array, a single
 * match returns the value itself.
 */
export function readPath(source, path) {
  if (path == null) return undefined;
  const expr = String(path).trim();
  if (!expr) return source;

  const tokens = expr
    .replace(/\[\s*(\*|\d+)\s*\]/g, ".$1")
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);

  let values = [source];
  for (const token of tokens) {
    const next = [];
    for (const value of values) {
      if (value == null) continue;
      if (token === "*") {
        if (Array.isArray(value)) next.push(...value);
        else if (typeof value === "object") next.push(...Object.values(value));
        continue;
      }
      if (Array.isArray(value)) {
        if (!/^\d+$/.test(token)) continue;
        const index = Number(token);
        if (index < value.length) next.push(value[index]);
        continue;
      }
      if (typeof value === "object" && Object.prototype.hasOwnProperty.call(value, token)) {
        next.push(value[token]);
      }
    }
    values = next;
  }

  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.+-]/g, "");
    if (!cleaned || cleaned === "+" || cleaned === "-" || cleaned === ".") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return undefined;
}

/** Parse a reset timestamp from ISO strings, epoch numbers, or relative offsets. */
export function parseCustomResetAt(value, unit = "auto") {
  if (value == null || value === "" || typeof value === "boolean") return null;

  const numeric = typeof value === "number"
    ? value
    : /^-?\d+(\.\d+)?$/.test(String(value).trim()) ? Number(value) : null;

  if (numeric != null) {
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    let ms;
    if (unit === "unix") ms = numeric * 1000;
    else if (unit === "unix_ms") ms = numeric;
    else if (unit === "seconds_from_now") ms = Date.now() + numeric * 1000;
    else if (unit === "minutes_from_now") ms = Date.now() + numeric * 60 * 1000;
    else ms = numeric < 1e11 ? numeric * 1000 : numeric; // auto: seconds vs milliseconds
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Fill {{apiKey}}, {{accessToken}}, {{baseUrl}}, {{provider}}, ... from a connection. */
export function fillCustomQuotaTemplate(value, connection = {}) {
  if (value == null) return "";
  const variables = {
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    baseUrl: connection.providerSpecificData?.baseUrl,
    provider: connection.provider,
    connectionId: connection.id,
    name: connection.name || connection.email || connection.displayName,
  };
  return String(value).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
    const replacement = variables[key];
    return replacement == null ? "" : String(replacement);
  });
}

function readValue(root, row, key) {
  const path = row?.[key];
  if (path == null || path === "") return undefined;
  return readPath(root, path);
}

function buildRow(root, row) {
  const creditBalance = toNumber(readValue(root, row, "creditBalancePath"));
  const resetAt = parseCustomResetAt(readValue(root, row, "resetAtPath"), row.resetAtUnit || "auto");
  const unit = readValue(root, row, "unitPath") ?? row.unit ?? undefined;
  const currency = readValue(root, row, "currencyPath") ?? row.currency ?? undefined;
  const nameFromPath = readValue(root, row, "namePath");
  const name = String(nameFromPath ?? row.name ?? "Quota");

  if (creditBalance != null) {
    return {
      name,
      used: 0,
      total: creditBalance,
      unit,
      currency,
      isCreditBalance: true,
      remaining: 100,
      remainingPercentage: 100,
      resetAt,
      recurring: row.recurring !== false,
      neverExpires: row.neverExpires === true,
    };
  }

  const unlimitedFlag = toBoolean(readValue(root, row, "unlimitedPath"));
  const rawTotal = toNumber(readValue(root, row, "totalPath"));
  const totalValue = row.totalValue != null && row.totalValue !== "" ? toNumber(row.totalValue) : null;
  let total = rawTotal ?? totalValue;
  let used = toNumber(readValue(root, row, "usedPath"));
  const remainingAbsolute = toNumber(readValue(root, row, "remainingPath"));
  const percentUsed = toNumber(readValue(root, row, "percentUsedPath"));
  const percentRemaining = toNumber(readValue(root, row, "percentRemainingPath"));

  const hasAnyValue = rawTotal != null || totalValue != null || used != null || remainingAbsolute != null
    || percentUsed != null || percentRemaining != null || unlimitedFlag !== undefined;
  if (!hasAnyValue) return null;

  // Percent-only sources render as a 0-100 share so the row still has a bar.
  const percentOnly = total == null && (percentUsed != null || percentRemaining != null);
  if (percentOnly) total = 100;

  const unlimited = unlimitedFlag === true || total == null || total <= 0;
  if (unlimited) total = 0;

  if (used == null && percentOnly) used = percentUsed ?? (100 - percentRemaining);
  if (used == null && total > 0) {
    if (remainingAbsolute != null) used = total - remainingAbsolute;
    else if (percentUsed != null) used = (total * percentUsed) / 100;
    else used = 0;
  }

  let remainingPercentage = null;
  if (percentUsed != null) remainingPercentage = 100 - percentUsed;
  else if (percentRemaining != null) remainingPercentage = percentRemaining;
  else if (remainingAbsolute != null && total > 0) remainingPercentage = (remainingAbsolute / total) * 100;
  else if (used != null && total > 0) remainingPercentage = ((total - used) / total) * 100;
  else if (unlimited) remainingPercentage = 100;

  if (remainingPercentage == null) return null;

  return {
    name,
    used: Math.max(0, used ?? 0),
    total,
    unit: unit || (percentOnly ? "%" : undefined),
    remaining: Math.max(0, Math.min(100, remainingPercentage)),
    remainingPercentage: Math.max(0, Math.min(100, remainingPercentage)),
    resetAt,
    unlimited,
    recurring: row.recurring !== false,
    neverExpires: row.neverExpires === true,
  };
}

/** Map a provider response body onto normalized quota rows the dashboard renders. */
export function resolveCustomQuota(config, body) {
  const rows = Array.isArray(config?.quotas) ? config.quotas : [];
  const quotas = [];

  for (const row of rows) {
    if (!row || row.enabled === false) continue;

    const itemsPath = row.itemsPath || config?.itemsPath;
    const roots = itemsPath ? toArray(readPath(body, itemsPath)) : [body];
    if (roots.length === 0) continue;

    for (const root of roots) {
      if (root == null) continue;
      const resolved = buildRow(root, row);
      if (resolved) quotas.push(resolved);
    }
  }

  if (quotas.length === 0) {
    return {
      plan: config?.plan || "Custom",
      message: "Custom quota: no values matched the configured JSON paths.",
      quotas: [],
    };
  }

  return { plan: config?.plan || "Custom", quotas };
}

export function validateCustomQuotaConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") return ["Config is required."];

  const url = String(config.request?.url || "").trim();
  if (!url) errors.push("Request URL is required.");
  else if (!url.includes("{{")) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) errors.push("Request URL must use http or https.");
    } catch {
      errors.push("Request URL is invalid.");
    }
  }

  const method = String(config.request?.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) errors.push("Method must be GET or POST.");

  if (!Array.isArray(config.quotas) || config.quotas.length === 0) {
    errors.push("Add at least one quota row.");
    return errors;
  }

  config.quotas.forEach((row, index) => {
    const label = row?.name ? `"${row.name}"` : `#${index + 1}`;
    if (!row?.name) errors.push(`Quota ${label}: name is required.`);
    const hasSource = ["usedPath", "totalPath", "remainingPath", "percentUsedPath", "percentRemainingPath", "creditBalancePath"]
      .some((key) => row?.[key]);
    if (!hasSource) errors.push(`Quota ${label}: add at least one value path.`);
  });

  return errors;
}

/** Fetch and resolve a custom quota source for a connection. */
export async function fetchCustomQuota(config, connection, { includeRaw = false, allowPrivateHosts } = {}) {
  const url = fillCustomQuotaTemplate(config?.request?.url || "", connection).trim();
  if (!url) return { message: "Custom quota: request URL is not configured." };

  const method = String(config.request?.method || "GET").toUpperCase();
  const headers = {};
  for (const header of config.request?.headers || []) {
    const name = fillCustomQuotaTemplate(header?.name || "", connection).trim();
    if (name) headers[name] = fillCustomQuotaTemplate(header?.value || "", connection);
  }
  if (Object.keys(headers).length === 0) {
    headers.Accept = "application/json";
    if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
  }

  const body = method === "POST" && config.request?.body
    ? fillCustomQuotaTemplate(config.request.body, connection)
    : undefined;
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  const allowPrivate = allowPrivateHosts ?? process.env.CUSTOM_QUOTA_ALLOW_PRIVATE_HOSTS === "1";
  const init = { method, headers, body, cache: "no-store" };

  let response;
  try {
    response = allowPrivate ? await fetch(url, init) : await fetchPublic(url, init);
  } catch (error) {
    return { message: `Custom quota request failed: ${error.message}` };
  }

  const text = await response.text();
  const extra = includeRaw ? { raw: text.slice(0, CUSTOM_QUOTA_RAW_LIMIT) } : {};

  if (!response.ok) {
    return { message: `Custom quota API error (${response.status}).`, ...extra };
  }

  let bodyJson;
  try {
    bodyJson = JSON.parse(text);
  } catch {
    return { message: "Custom quota response is not JSON.", ...extra };
  }

  const resolved = resolveCustomQuota(config, bodyJson);
  return { ...resolved, ...extra };
}
