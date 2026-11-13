import {
  CUSTOM_JSON_DEFAULTS, CUSTOM_JSON_METHODS, CUSTOM_JSON_AUTH_TYPES,
  CUSTOM_JSON_VARIABLES, CUSTOM_JSON_MAX_TEMPLATE_SIZE, CUSTOM_JSON_MAX_DEPTH,
  CUSTOM_JSON_BLOCKED_KEYS, CUSTOM_JSON_BLOCKED_HEADERS,
} from "../config/customJson.js";

const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function pathParts(path) {
  if (path === "$") return [];
  const normalized = path.replace(/^\$\./, "").replace(/\[(\d+)\]/g, ".$1");
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(normalized)) {
    throw new Error(`Invalid field path: ${path}`);
  }
  const parts = normalized.split(".");
  if (parts.some((part) => CUSTOM_JSON_BLOCKED_KEYS.includes(part))) throw new Error("Unsafe field path");
  return parts;
}

export function readJsonPath(value, path) {
  return pathParts(path).reduce((current, key) => (
    current != null && Object.hasOwn(Object(current), key) ? current[key] : undefined
  ), value);
}

function visit(value, stringFn, depth = 0) {
  if (depth > CUSTOM_JSON_MAX_DEPTH) throw new Error("Request template is nested too deeply");
  if (typeof value === "string") return stringFn(value);
  if (Array.isArray(value)) return value.map((item) => visit(item, stringFn, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (CUSTOM_JSON_BLOCKED_KEYS.includes(key)) throw new Error("Unsafe template key");
      return [key, visit(item, stringFn, depth + 1)];
    }));
  }
  return value;
}

export function normalizeCustomJsonConfig(input, endpoint) {
  if (!isObject(input)) throw new Error("Custom JSON configuration is required");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("A complete HTTP(S) endpoint URL is required"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Use an HTTP(S) endpoint without URL credentials or a fragment");
  }
  const config = { ...CUSTOM_JSON_DEFAULTS, ...input };
  if (!CUSTOM_JSON_METHODS.includes(config.method)) throw new Error("Invalid custom JSON HTTP method");
  if (!CUSTOM_JSON_AUTH_TYPES.includes(config.authType)) throw new Error("Invalid custom JSON authentication type");
  if (!isObject(config.requestTemplate)) throw new Error("Request template must be a JSON object");
  if (JSON.stringify(config.requestTemplate).length > CUSTOM_JSON_MAX_TEMPLATE_SIZE) throw new Error("Request template exceeds 64 KB");
  visit(config.requestTemplate, (value) => {
    const remainder = value.replace(tokenPattern, (_, path) => {
      const parts = pathParts(path.trim());
      if (!CUSTOM_JSON_VARIABLES.includes(parts[0])) throw new Error(`Unknown template variable: ${path}`);
      return "";
    });
    if (remainder.includes("{{") || remainder.includes("}}")) throw new Error("Invalid template placeholder");
    return value;
  });
  if (typeof config.responsePath !== "string" || !config.responsePath.trim()) throw new Error("Response field path is required (use $ for the entire JSON response)");
  config.responsePath = config.responsePath.trim();
  pathParts(config.responsePath);
  if (!isObject(config.headers) || Object.keys(config.headers).length > 20) throw new Error("Custom headers must be a JSON object with at most 20 entries");
  for (const [name, value] of Object.entries(config.headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || CUSTOM_JSON_BLOCKED_HEADERS.includes(name.toLowerCase()) || CUSTOM_JSON_BLOCKED_KEYS.includes(name)) throw new Error(`Header cannot be configured: ${name}`);
    if (typeof value !== "string" || /[\r\n]/.test(value) || value.length > 8192) throw new Error(`Invalid header value: ${name}`);
  }
  if (config.authType === "api-key" && (typeof config.authHeader !== "string" || !/^[A-Za-z0-9-]+$/.test(config.authHeader) || CUSTOM_JSON_BLOCKED_HEADERS.includes(config.authHeader.toLowerCase()))) {
    throw new Error("Invalid API key header name");
  }
  // Persist only documented fields; never arbitrary runtime options or executable code.
  return Object.fromEntries(Object.keys(CUSTOM_JSON_DEFAULTS).map((key) => [key, config[key]]));
}

export function buildCustomJsonRequest(config, model, body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = messages.findLast((message) => message.role === "user");
  const prompt = typeof user?.content === "string" ? user.content : (
    Array.isArray(user?.content) ? user.content.filter((part) => part.type === "text").map((part) => part.text || "").join("\n") : ""
  );
  const variables = { prompt, messages, model, stream: false, request: body };
  const resolve = (path) => {
    const value = readJsonPath(variables, path.trim());
    if (value === undefined) throw new Error(`Missing template value: ${path.trim()}`);
    return value;
  };
  return visit(config.requestTemplate, (value) => {
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) return resolve(exact[1]);
    return value.replace(tokenPattern, (_, path) => {
      const resolved = resolve(path);
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  });
}

export function buildCustomJsonHeaders(config, apiKey) {
  const headers = { ...config.headers, "Content-Type": "application/json", Accept: "application/json" };
  if (config.authType !== "none" && !apiKey) throw new Error("API key is required for this custom JSON endpoint");
  if (config.authType === "bearer") headers.Authorization = `Bearer ${apiKey}`;
  if (config.authType === "api-key") {
    for (const name of Object.keys(headers)) if (name.toLowerCase() === config.authHeader.toLowerCase()) delete headers[name];
    headers[config.authHeader] = apiKey;
  }
  return headers;
}

export function extractCustomJsonText(config, data) {
  const value = readJsonPath(data, config.responsePath);
  if (value === undefined || value === null) throw new Error(`Response field not found: ${config.responsePath}`);
  return typeof value === "string" ? value : JSON.stringify(value);
}
